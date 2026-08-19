// Pure visual-prototype fixtures only. They are not API responses or user data.
// Do not replace these records with persistence, HTTP, or inferred relationships.

export type PrototypeTrackItem = {
  id: string
  status: string
  title: string
  startAction?: string
  reviewSummary?: string
}

export type PrototypeExplorationTrack = {
  id: string
  name: string
  lifecycle: 'active' | 'deleted'
  recent: string
  currentItems: PrototypeTrackItem[]
  history: PrototypeTrackItem[]
  abandonedHistory: PrototypeTrackItem[]
}

export const prototypeExplorationTracks: PrototypeExplorationTrack[] = [
  {
    id: 'prototype-erhu',
    name: '学习拉二胡',
    lifecycle: 'active',
    recent: '最近：预约一次线下二胡体验课 · 进行中',
    currentItems: [
      { id: 'prototype-erhu-lesson', status: '进行中', title: '预约一次线下二胡体验课', startAction: '联系附近的一家琴行' },
      { id: 'prototype-erhu-bow', status: '想试试', title: '连续练习一周基础运弓' },
      { id: 'prototype-erhu-listen', status: '以后再说', title: '听三位演奏者的处理差异' },
    ],
    history: [
      { id: 'prototype-erhu-buy', status: '已复盘', title: '买一把二胡并尝试最简单曲子', reviewSummary: '购买完成；练习中发现持琴姿势是主要卡点。' },
      { id: 'prototype-erhu-notes', status: '已复盘', title: '记录第一次练习后的身体感受', reviewSummary: '复盘详情请在事项中查看。' },
    ],
    abandonedHistory: [
      { id: 'prototype-erhu-app', status: '已放弃', title: '先找一款练琴打卡应用', reviewSummary: '复盘详情请在事项中查看。' },
    ],
  },
  {
    id: 'prototype-k8s',
    name: '学习 K8s',
    lifecycle: 'active',
    recent: '最近：尝试本机安装 Minikube · 已复盘',
    currentItems: [],
    history: [
      { id: 'prototype-k8s-minikube', status: '已复盘', title: '尝试本机安装 Minikube', reviewSummary: '环境已跑通；下一步只验证一个最小部署。' },
    ],
    abandonedHistory: [],
  },
  {
    id: 'prototype-run',
    name: '建立晨跑习惯',
    lifecycle: 'active',
    recent: '暂无关联行动',
    currentItems: [],
    history: [],
    abandonedHistory: [],
  },
]

export const prototypeDeletedExplorationTracks: PrototypeExplorationTrack[] = [
  {
    id: 'prototype-deleted-writing',
    name: '写一组城市观察',
    lifecycle: 'deleted',
    recent: '已删除主线 · 仅供回看',
    currentItems: [{ id: 'prototype-writing-walk', status: '已暂停', title: '在晚间散步时记录三个场景', startAction: '带上纸笔' }],
    history: [{ id: 'prototype-writing-note', status: '已复盘', title: '完成第一篇短观察', reviewSummary: '复盘详情请在事项中查看。' }],
    abandonedHistory: [],
  },
]
