import { Image, Text, View } from '@tarojs/components'
import { isTauriRuntime } from './api-client'

// 大陆备案的展示要求（工信部 ICP 备案 + 公安联网备案）：
//   - 备案号必须在网站首页底部可见，不得隐藏或用极小字号弱化；
//   - ICP 备案号与公安联网备案号都必须可点击跳转到官方查询页，纯文本不合格；
//   - 公安备案需同时展示官方下发的图标，且不得自行改绘或替换。
//
// 备案约束的是「网站」。桌面端是本地程序，不经由公网域名对外提供页面，
// 因此仅在 H5（浏览器）下渲染；Tauri 运行时直接不输出该节点。
const ICP_NUMBER = '浙ICP备2026080693号'
const ICP_QUERY_URL = 'https://beian.miit.gov.cn/'
const GONGAN_NUMBER = '浙公网安备33010502013589号'
const GONGAN_QUERY_URL = 'https://beian.mps.gov.cn/#/query/webSearch?code=33010502013589'
const gonganIconUrl = new URL('../../assets/brand/beian-gongan.png', import.meta.url).href

function openOfficialQuery(url: string): void {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

export function SiteFilingFooter() {
  if (isTauriRuntime()) return null
  return <View className='site-filing-footer'>
    <View className='site-filing-row'>
      <View className='site-filing-link' onClick={() => openOfficialQuery(ICP_QUERY_URL)}>{ICP_NUMBER}</View>
      <Text className='site-filing-divider'>·</Text>
      <Image className='site-filing-icon' src={gonganIconUrl} mode='aspectFit' />
      <View className='site-filing-link' onClick={() => openOfficialQuery(GONGAN_QUERY_URL)}>{GONGAN_NUMBER}</View>
    </View>
  </View>
}
