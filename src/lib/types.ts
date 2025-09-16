import { AdminConfig } from './admin.types';

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
  origin?: 'vod' | 'live' | 'shortdrama';
}

// 短剧分类数据结构
export interface ShortDramaCategory {
  type_id: number;
  type_name: string;
}

// 短剧列表项数据结构
export interface ShortDramaItem {
  id: number;
  name: string;
  cover: string;
  update_time: string;
  score: number;
  episode_count: number;
  description?: string;
}

// 短剧解析结果数据结构
export interface ShortDramaParseResult {
  code: number;
  msg?: string;
  data?: {
    videoId: number;
    videoName: string;
    currentEpisode: number;
    totalEpisodes: number;
    parsedUrl: string;
    proxyUrl: string;
    cover: string;
    description: string;
    episode?: {
      index: number;
      label: string;
      parsedUrl: string;
    };
  };
}

// 短剧API响应数据结构
export interface ShortDramaResponse<T> {
  code: number;
  msg?: string;
  data: T;
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳过片头片尾配置相关
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // 数据清理相关
  clearAllData(): Promise<void>;

  // 通用缓存相关（新增）
  getCache(key: string): Promise<any | null>;
  setCache(key: string, data: any, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
  clearExpiredCache(prefix?: string): Promise<void>;

  // 播放统计相关
  getPlayStats(): Promise<PlayStatsResult>;
  getUserPlayStat(userName: string): Promise<UserPlayStat>;
  getContentStats(limit?: number): Promise<ContentStat[]>;
  updatePlayStatistics(
    userName: string,
    source: string,
    id: string,
    watchTime: number
  ): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  // 详细信息字段
  directors?: string[];
  screenwriters?: string[];
  cast?: string[];
  genres?: string[];
  countries?: string[];
  languages?: string[];
  episodes?: number;
  episode_length?: number;
  movie_duration?: number;
  first_aired?: string;
  plot_summary?: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳过片头片尾配置数据结构
export interface SkipConfig {
  enable: boolean; // 是否启用跳过片头片尾
  intro_time: number; // 片头时间（秒）
  outro_time: number; // 片尾时间（秒）
}

// 用户播放统计数据结构
export interface UserPlayStat {
  username: string; // 用户名
  totalWatchTime: number; // 总观看时间（秒）
  totalPlays: number; // 总播放次数
  lastPlayTime: number; // 最后播放时间戳
  recentRecords: PlayRecord[]; // 最近播放记录（最多10条）
  avgWatchTime: number; // 平均每次观看时长
  mostWatchedSource: string; // 最常观看的来源
}

// 全站播放统计数据结构
export interface PlayStatsResult {
  totalUsers: number; // 总用户数
  totalWatchTime: number; // 全站总观看时间
  totalPlays: number; // 全站总播放次数
  avgWatchTimePerUser: number; // 用户平均观看时长
  avgPlaysPerUser: number; // 用户平均播放次数
  userStats: UserPlayStat[]; // 每个用户的统计
  topSources: Array<{
    // 热门来源统计（前5名）
    source: string;
    count: number;
  }>;
  dailyStats: Array<{
    // 近7天每日统计
    date: string;
    watchTime: number;
    plays: number;
  }>;
}

// 内容热度统计数据结构
export interface ContentStat {
  source: string;
  id: string;
  title: string;
  source_name: string;
  cover: string;
  year: string;
  playCount: number; // 播放次数
  totalWatchTime: number; // 总观看时长
  averageWatchTime: number; // 平均观看时长
  lastPlayed: number; // 最后播放时间
  uniqueUsers: number; // 观看用户数
}
