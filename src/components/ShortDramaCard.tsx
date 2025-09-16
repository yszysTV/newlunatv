/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Play, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ShortDramaItem } from '@/lib/types';
import {
  SHORTDRAMA_CACHE_EXPIRE,
  getCacheKey,
  getCache,
  setCache,
} from '@/lib/shortdrama-cache';

interface ShortDramaCardProps {
  drama: ShortDramaItem;
  showDescription?: boolean;
  className?: string;
}

export default function ShortDramaCard({
  drama,
  showDescription = false,
  className = '',
}: ShortDramaCardProps) {
  const [realEpisodeCount, setRealEpisodeCount] = useState<number>(drama.episode_count);

  // 获取真实集数（带统一缓存）
  useEffect(() => {
    const fetchEpisodeCount = async () => {
      const cacheKey = getCacheKey('episodes', { id: drama.id });

      // 检查统一缓存
      const cached = await getCache(cacheKey);
      if (cached && typeof cached === 'number' && cached > 0) {
        setRealEpisodeCount(cached);
        return;
      }

      try {
        // 先尝试第1集（episode=0）
        let response = await fetch(`/api/shortdrama/parse?id=${drama.id}&episode=0`);
        let result = null;

        if (response.ok) {
          result = await response.json();
        }

        // 如果第1集失败，尝试第2集（episode=1）
        if (!result || !result.totalEpisodes) {
          response = await fetch(`/api/shortdrama/parse?id=${drama.id}&episode=1`);
          if (response.ok) {
            result = await response.json();
          }
        }

        if (result && result.totalEpisodes > 0) {
          setRealEpisodeCount(result.totalEpisodes);
          // 使用统一缓存系统缓存结果
          await setCache(cacheKey, result.totalEpisodes, SHORTDRAMA_CACHE_EXPIRE.episodes);
        } else {
          // 如果解析失败，缓存失败结果避免重复请求
          await setCache(cacheKey, 1, SHORTDRAMA_CACHE_EXPIRE.episodes / 24); // 1小时后重试
        }
      } catch (error) {
        console.error('获取集数失败:', error);
        // 网络错误时也缓存失败结果
        await setCache(cacheKey, 1, SHORTDRAMA_CACHE_EXPIRE.episodes / 24); // 1小时后重试
      }
    };

    // 只有当前集数为1（默认值）时才尝试获取真实集数
    if (drama.episode_count === 1) {
      fetchEpisodeCount();
    }
  }, [drama.id, drama.episode_count]);

  const formatScore = (score: number) => {
    return score > 0 ? score.toFixed(1) : '--';
  };

  const formatUpdateTime = (updateTime: string) => {
    try {
      const date = new Date(updateTime);
      return date.toLocaleDateString('zh-CN');
    } catch {
      return updateTime;
    }
  };

  return (
    <div className={`group relative ${className}`}>
      <Link
        href={`/play?source=shortdrama&id=${drama.id}&title=${encodeURIComponent(drama.name)}`}
        className="block"
      >
        {/* 封面图片 */}
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800">
          <img
            src={drama.cover}
            alt={drama.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder-cover.jpg';
            }}
          />

          {/* 悬浮播放按钮 */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
              <Play className="h-5 w-5 ml-0.5" fill="currentColor" />
            </div>
          </div>

          {/* 集数标识 */}
          <div className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
            {realEpisodeCount}集
          </div>

          {/* 评分 */}
          {drama.score > 0 && (
            <div className="absolute top-2 right-2 flex items-center rounded bg-yellow-500 px-2 py-1 text-xs text-white">
              <Star className="h-3 w-3 mr-1" fill="currentColor" />
              {formatScore(drama.score)}
            </div>
          )}
        </div>

        {/* 信息区域 */}
        <div className="mt-2 space-y-1">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {drama.name}
          </h3>

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>更新: {formatUpdateTime(drama.update_time)}</span>
          </div>

          {/* 描述信息（可选） */}
          {showDescription && drama.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
              {drama.description}
            </p>
          )}
        </div>
      </Link>
    </div>
  );
}