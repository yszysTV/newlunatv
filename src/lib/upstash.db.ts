/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import {
  ContentStat,
  Favorite,
  IStorage,
  PlayRecord,
  PlayStatsResult,
  SkipConfig,
  UserPlayStat,
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await withRetry(() => this.client.del(...skipConfigKeys));
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipConfigKey(userName, source, id), config)
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await withRetry(() => this.client.mget(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = value as SkipConfig;
        }
      }
    });

    return configs;
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // ---------- 通用缓存方法 ----------
  private cacheKey(key: string) {
    return `cache:${key}`;
  }

  async getCache(key: string): Promise<any | null> {
    try {
      const val = await withRetry(() => this.client.get(this.cacheKey(key)));
      if (!val) return null;
      
      // 智能处理返回值：Upstash 可能返回字符串或已解析的对象
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch (parseError) {
          console.warn(`JSON解析失败，返回原字符串 (key: ${key}):`, parseError);
          return val; // 解析失败返回原字符串
        }
      } else {
        // Upstash 可能直接返回解析后的对象
        return val;
      }
    } catch (error) {
      console.error(`Upstash getCache error (key: ${key}):`, error);
      return null;
    }
  }

  async setCache(key: string, data: any, expireSeconds?: number): Promise<void> {
    const cacheKey = this.cacheKey(key);
    const value = JSON.stringify(data);
    
    if (expireSeconds) {
      await withRetry(() => this.client.setex(cacheKey, expireSeconds, value));
    } else {
      await withRetry(() => this.client.set(cacheKey, value));
    }
  }

  async deleteCache(key: string): Promise<void> {
    await withRetry(() => this.client.del(this.cacheKey(key)));
  }

  async clearExpiredCache(prefix?: string): Promise<void> {
    // Upstash的TTL机制会自动清理过期数据，这里主要用于手动清理
    // 可以根据需要实现特定前缀的缓存清理
    const pattern = prefix ? `cache:${prefix}*` : 'cache:*';
    const keys = await withRetry(() => this.client.keys(pattern));

    if (keys.length > 0) {
      await withRetry(() => this.client.del(...keys));
      console.log(`Cleared ${keys.length} cache entries with pattern: ${pattern}`);
    }
  }

  // ---------- 播放统计相关 ----------
  async getPlayStats(): Promise<PlayStatsResult> {
    try {
      // 尝试从缓存获取
      const cached = await this.getCache('play_stats_summary');
      if (cached) {
        return cached as PlayStatsResult;
      }

      // 重新计算统计数据
      const allUsers = await this.getAllUsers();
      const userStats: UserPlayStat[] = [];
      let totalWatchTime = 0;
      let totalPlays = 0;
      const sourceCount: Record<string, number> = {};
      const dailyData: Record<string, { watchTime: number; plays: number }> = {};

      // 计算近7天的日期范围
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      for (const username of allUsers) {
        const userStat = await this.getUserPlayStat(username);
        userStats.push(userStat);
        totalWatchTime += userStat.totalWatchTime;
        totalPlays += userStat.totalPlays;

        // 获取用户的播放记录来统计源和每日数据
        const records = await this.getAllPlayRecords(username);
        Object.values(records).forEach((record) => {
          const sourceName = record.source_name || '未知来源';
          sourceCount[sourceName] = (sourceCount[sourceName] || 0) + 1;

          const recordDate = new Date(record.save_time);
          if (recordDate >= sevenDaysAgo) {
            const dateKey = recordDate.toISOString().split('T')[0];
            if (!dailyData[dateKey]) {
              dailyData[dateKey] = { watchTime: 0, plays: 0 };
            }
            dailyData[dateKey].watchTime += record.play_time || 0;
            dailyData[dateKey].plays += 1;
          }
        });
      }

      // 按观看时间降序排序
      userStats.sort((a, b) => b.totalWatchTime - a.totalWatchTime);

      // 整理热门来源数据
      const topSources = Object.entries(sourceCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([source, count]) => ({ source, count }));

      // 整理近7天数据
      const dailyStats: Array<{ date: string; watchTime: number; plays: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        const data = dailyData[dateKey] || { watchTime: 0, plays: 0 };
        dailyStats.push({
          date: dateKey,
          watchTime: data.watchTime,
          plays: data.plays,
        });
      }

      const result: PlayStatsResult = {
        totalUsers: allUsers.length,
        totalWatchTime,
        totalPlays,
        avgWatchTimePerUser: allUsers.length > 0 ? totalWatchTime / allUsers.length : 0,
        avgPlaysPerUser: allUsers.length > 0 ? totalPlays / allUsers.length : 0,
        userStats,
        topSources,
        dailyStats,
      };

      // 缓存结果30分钟
      await this.setCache('play_stats_summary', result, 1800);
      return result;
    } catch (error) {
      console.error('获取播放统计失败:', error);
      throw error;
    }
  }

  async getUserPlayStat(userName: string): Promise<UserPlayStat> {
    try {
      // 获取用户的所有播放记录
      const records = await this.getAllPlayRecords(userName);
      const playRecords = Object.values(records);

      if (playRecords.length === 0) {
        return {
          username: userName,
          totalWatchTime: 0,
          totalPlays: 0,
          lastPlayTime: 0,
          recentRecords: [],
          avgWatchTime: 0,
          mostWatchedSource: '',
        };
      }

      // 计算统计
      let totalWatchTime = 0;
      let lastPlayTime = 0;
      const sourceCount: Record<string, number> = {};

      playRecords.forEach((record) => {
        totalWatchTime += record.play_time || 0;
        if (record.save_time > lastPlayTime) {
          lastPlayTime = record.save_time;
        }
        const sourceName = record.source_name || '未知来源';
        sourceCount[sourceName] = (sourceCount[sourceName] || 0) + 1;
      });

      // 获取最近播放记录
      const recentRecords = playRecords
        .sort((a, b) => (b.save_time || 0) - (a.save_time || 0))
        .slice(0, 10);

      // 找出最常观看的来源
      let mostWatchedSource = '';
      let maxCount = 0;
      for (const [source, count] of Object.entries(sourceCount)) {
        if (count > maxCount) {
          maxCount = count;
          mostWatchedSource = source;
        }
      }

      return {
        username: userName,
        totalWatchTime,
        totalPlays: playRecords.length,
        lastPlayTime,
        recentRecords,
        avgWatchTime: playRecords.length > 0 ? totalWatchTime / playRecords.length : 0,
        mostWatchedSource,
      };
    } catch (error) {
      console.error(`获取用户 ${userName} 统计失败:`, error);
      return {
        username: userName,
        totalWatchTime: 0,
        totalPlays: 0,
        lastPlayTime: 0,
        recentRecords: [],
        avgWatchTime: 0,
        mostWatchedSource: '',
      };
    }
  }

  async getContentStats(limit = 10): Promise<ContentStat[]> {
    try {
      // 获取所有用户的播放记录
      const allUsers = await this.getAllUsers();
      const contentStats: Record<string, {
        source: string;
        id: string;
        title: string;
        source_name: string;
        cover: string;
        year: string;
        playCount: number;
        totalWatchTime: number;
        uniqueUsers: Set<string>;
        lastPlayed: number;
      }> = {};

      for (const username of allUsers) {
        const records = await this.getAllPlayRecords(username);
        Object.entries(records).forEach(([key, record]) => {
          if (!contentStats[key]) {
            // 从key中解析source和id
            const [source, id] = key.split('+', 2);
            contentStats[key] = {
              source: source || '',
              id: id || '',
              title: record.title || '未知标题',
              source_name: record.source_name || '未知来源',
              cover: record.cover || '',
              year: record.year || '',
              playCount: 0,
              totalWatchTime: 0,
              uniqueUsers: new Set(),
              lastPlayed: 0,
            };
          }

          const stat = contentStats[key];
          stat.playCount += 1;
          stat.totalWatchTime += record.play_time || 0;
          stat.uniqueUsers.add(username);
          if (record.save_time > stat.lastPlayed) {
            stat.lastPlayed = record.save_time;
          }
        });
      }

      // 转换 Set 为数量并排序
      const result = Object.values(contentStats)
        .map((stat) => ({
          source: stat.source,
          id: stat.id,
          title: stat.title,
          source_name: stat.source_name,
          cover: stat.cover,
          year: stat.year,
          playCount: stat.playCount,
          totalWatchTime: stat.totalWatchTime,
          averageWatchTime: stat.playCount > 0 ? stat.totalWatchTime / stat.playCount : 0,
          lastPlayed: stat.lastPlayed,
          uniqueUsers: stat.uniqueUsers.size,
        }))
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit);

      return result;
    } catch (error) {
      console.error('获取内容统计失败:', error);
      return [];
    }
  }

  async updatePlayStatistics(
    _userName: string,
    _source: string,
    _id: string,
    _watchTime: number
  ): Promise<void> {
    try {
      // 清除全站统计缓存，下次查询时重新计算
      await this.deleteCache('play_stats_summary');
    } catch (error) {
      console.error('更新播放统计失败:', error);
    }
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
