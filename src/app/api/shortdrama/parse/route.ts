/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { parseShortDramaEpisode } from '@/lib/shortdrama.client';

// 标记为动态路由
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    const episode = searchParams.get('episode');

    if (!id || !episode) {
      return NextResponse.json(
        { error: '缺少必要参数: id, episode' },
        { status: 400 }
      );
    }

    const videoId = parseInt(id);
    const episodeNum = parseInt(episode);

    if (isNaN(videoId) || isNaN(episodeNum)) {
      return NextResponse.json(
        { error: '参数格式错误' },
        { status: 400 }
      );
    }

    // 解析视频，默认使用代理
    const result = await parseShortDramaEpisode(videoId, episodeNum, true);

    if (result.code !== 0) {
      return NextResponse.json(
        { error: result.msg || '解析失败' },
        { status: 400 }
      );
    }

    // 返回视频URL，优先使用代理URL避免CORS问题
    const episodeData = result.data?.episode;
    const parsedUrl = episodeData?.parsedUrl || result.data!.parsedUrl || '';
    const proxyUrl = result.data!.proxyUrl || '';

    const response = {
      url: proxyUrl || parsedUrl, // 优先使用代理URL
      originalUrl: parsedUrl,
      proxyUrl: proxyUrl,
      title: result.data!.videoName || '',
      episode: result.data!.currentEpisode || episodeNum,
      totalEpisodes: result.data!.totalEpisodes || 1,
    };

    // 设置与豆瓣一致的缓存策略
    const cacheTime = await getCacheTime();
    const finalResponse = NextResponse.json(response);
    finalResponse.headers.set('Cache-Control', `public, max-age=${cacheTime}, s-maxage=${cacheTime}`);
    finalResponse.headers.set('CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    finalResponse.headers.set('Vercel-CDN-Cache-Control', `public, s-maxage=${cacheTime}`);
    finalResponse.headers.set('Netlify-Vary', 'query');

    return finalResponse;
  } catch (error) {
    console.error('短剧解析失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}