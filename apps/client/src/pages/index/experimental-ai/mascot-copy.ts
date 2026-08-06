import type { MascotCalendarContext } from './mascot-calendar'

export type MascotAiState = 'thinking' | 'complete' | 'error' | 'idle'
export type MascotSessionKind = 'new' | 'existing'

export interface MascotCopyContext extends MascotCalendarContext {
  aiState?: MascotAiState
  sessionKind?: MascotSessionKind
  isListening?: boolean
  isFirstClick?: boolean
  isContinuousClick?: boolean
}

export interface MascotBubbleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface MascotBubbleSelection {
  text: string
  isHolidayFirst: boolean
}

const holidayFirstPrefix = 'knowledge-base:mascot:holiday-first-shown:'
const memoryStorage = new Set<string>()

const copy = {
  morning: ['早安，今天也是充满可能的一天呢。', '早上好！准备好开启今天的工作了吗？', '清晨的风很舒服，希望你今天有个好心情。', '早呀，昨晚睡得好吗？', '新的一天开始了，慢慢来，不着急。'],
  noon: ['已经中午啦，先放下手头的事情去吃个饭吧。', '午后的阳光真好，适合稍微眯一会儿休息下。', '肚子有好好填饱吗？休息好了再继续吧。', '泡杯茶或者咖啡吧，给大脑放个短假。', '午休时间到了，别太累着自己哦。'],
  afternoon: ['下午也别忘了给自己留一点喘息。', '把手边的事情理一理，慢慢来就好。', '午后的光线很温柔，适合整理新的思绪。', '今天已经走了很远，记得稍微休息一下。'],
  night: ['夜深了，今天也辛苦你啦。', '已经很晚了哦，早点休息，明天再继续吧。', '安静的夜晚，思路好像会格外清晰呢。', '累了的话就停下来吧，身体才是最重要的。', '晚安，愿你今晚有个香甜的梦。'],
  workday: ['忙碌的时候，也别忘了停下来喝口水。', '一步一步来，繁杂的事情总会一件件搞定的。', '感觉累了就伸个懒腰吧，你已经很棒了。', '工作再忙，也要照顾好自己的情绪哦。', '加油，我会一直在这里陪着你的。'],
  weekend: ['难得的周末，好好享受属于自己的时间吧。', '不用赶时间的感觉真好，今天打算做点什么呢？', '放慢脚步，去感受一下生活中的小确幸吧。', '周末就别想工作啦，彻底放松一下。', '希望你度过一个惬意又充实的假期。'],
  newYear: ['新的一年到了！愿你所有的期待都能如愿。', '跨过旧岁，迎向全新的开始，元旦快乐！', '新的一年，希望我们能一起探索更多有趣的事。', '岁岁常欢愉，年年皆胜意，元旦快乐呀。', '把烦恼留在过去，带着好心情迎接新的一年吧。'],
  springFestival: ['新春快乐！愿你岁岁平安，万事顺意。', '闻到烟火气和年夜饭的香味了吗？新春安康！', '爆竹声声除旧岁，祝你和家人新春快乐。', '愿新的一年，多一些欢笑，少一些烦恼。', '欢欢喜喜过大年，祝你新的一年好运连连！'],
  lanternFestival: ['元宵节快乐！今晚有去赏灯或者吃汤圆吗？', '月圆人团圆，愿你的生活像汤圆一样甜甜满满。', '灯火通明之夜，愿所有美好都如期而至。', '一口吃下甜甜的元宵，把福气全都收下吧。', '今晚的月色很美，元宵佳节平安喜乐！'],
  qingming: ['微风细雨的时节，适合静下心来思念与感受。', '草木吐绿，春意渐浓，愿你珍惜当下的每一天。', '踏青赏春的时节，不妨去户外呼吸一下新鲜空气。', '缅怀过往，也请怀抱希望继续温暖前行。', '春风吹拂大地，万物都在悄悄复苏呢。'],
  laborDay: ['劳动节快乐！每一份付出的努力都值得被尊重。', '辛苦了这么久，这几天就尽情放空自己吧。', '好好享受这个属于劳动者的假期吧！', '劳逸结合才是高效的秘诀，今天就只管休息。', '暂时放下手头的事，去放松一下绷紧的神经吧。'],
  dragonBoatFestival: ['端午安康！今天有吃到喜欢的粽子吗？', '咸粽还是甜粽？不论哪种，开心最重要啦。', '粽香袅袅，愿你平安健康，事事顺心。', '艾草飘香的季节，祝你端午安康。', '祝你在这个夏日初临的时节，生活美满惬意。'],
  qixi: ['七夕快乐！愿你被爱意包围，温柔相伴。', '今晚的星空真美，愿你遇到心意相通的人。', '无论是两个人还是一个人，都要好好爱自己。', '美好的情感就像星光，总能照亮前行的路。', '在这个浪漫的日子里，祝你今天心情甜甜的。'],
  midAutumnFestival: ['中秋快乐！今天有和家人一起赏月吃月饼吗？', '月圆人安，愿你所思念的人都能平安顺遂。', '抬头看看今晚的明月吧，风里都有桂花的香气呢。', '一轮明月寄相思，祝你中秋佳节团团圆圆。', '愿你的生活像中秋的月亮一样，圆满明亮。'],
  nationalDay: ['国庆快乐！享受这个难得的七天长假吧。', '举国同庆的日子，祝你度过一个愉快的假期！', '趁着假期，去想去的地方或者好好睡个饱觉吧。', '山河壮丽，人间烟火，祝你假期充实又开心。', '节日快乐！尽情享受这几天轻松的时光吧。'],
  winterSolstice: ['冬至到了，今天记得吃饺子或者汤圆哦！', '昼最短，夜最长，愿我的问候能带给你一丝暖意。', '天寒地冻的，要注意保暖，别着凉了。', '冬至大如年，祝你在这个冬日里温暖安康。', '最寒冷的日子过去了，春天就不远啦。'],
  christmas: ['圣诞快乐！今晚会有意想不到的小惊喜吗？', '虽然天气很冷，但心里要一直热气腾腾的哦。', '愿在这个飘雪的季节里，温暖与你撞个满怀。', 'Merry Christmas！祝你拥有一个浪漫的冬夜。', '听，好像有圣诞铃声在响呢，祝你节日快乐！'],
  newSession: ['你好呀，今天想聊点什么呢？', '随时准备好了，说出你的想法吧。', '很高兴见到你！有什么我可以帮你的吗？', '准备开启新的对话啦，请告诉我吧。', '我在听呢，尽管说吧。'],
  existingSession: ['我们接着刚才的话题继续吧？', '刚才说到这里了，你继续说，我在听。', '随时可以接上刚才的思路哦。', '好的，我们继续往下探讨吧。', '之前的记录都在这里，随时可以继续。'],
  inputIdle: ['不用着急，想好了再告诉我。', '我在安静听着呢，你可以慢慢整理语言。', '准备好了随时发给我哦。', '随时输入你的想法，我一直都在。', '有任何问题或想法，都可以随时告诉我。'],
  listening: ['正在认真看你写的内容呢...', '看来你正在思考一个有趣的问题。', '文字正在成型，我很期待你的想法。', '慢慢写，我不赶时间。', '看到你在输入了，正在耐心等待中。'],
  inputLong: ['字数很多呢，你认真思考了好多内容呀。', '收到啦，这么丰富的内容，容我仔细看一看。', '感受到了你的认真，我会一字一句读完的。', '信息量很大呢，让我好好整理一下思路。', '能看到你这么详细的表达，真的很棒。'],
  thinking: ['让我想想看，怎么回答最合适...', '正在帮你整理思路，稍等片刻哦。', '正在认真斟酌字句，马上就好。', '稍微给我一点点时间，正在思考中。', '正在为你组织语言，请稍等一下下。'],
  complete: ['希望我的回答能对你有所帮助！', '以上是我的建议啦，你看怎么样？', '回答完成！如果还有疑问可以随时问我。', '希望这个思路能给你带来启发。', '整理好了，你看看合不合心意。'],
  error: ['好像遇到了一点波折，我们再试一次吧。', '刚才的思路被打断了，我还在这里。'],
  userIdle: ['暂时走开了吗？没关系，我在这里等你回来。', '去喝口水或者休息一下吧，我不走。', '累了的话就先忙别的，随时回来找我。', '暂时停下来也没关系，顺其自然就好。', '窗口会一直为你留着，随时回来哦。'],
  firstClick: ['呀，你点了我一下呢。', '嗯？是在叫我吗？', '你好呀，很高兴被你注意到！', '找我有什么事吗？随时听候吩咐。', '嘻嘻，被你发现啦。'],
  continuousClick: ['哎呀，戳太多下我会害羞的啦。', '一直点我的话，我会不知道该怎么反应了哦。', '哈哈，是今天心情很好想和我玩吗？', '别一直戳啦，快告诉我你遇到了什么问题。', '咚咚！收到你的连续敲击啦。'],
  enterAiPage: ['欢迎来到对话空间，今天想交流些什么？', '这里是我们的专属交流区，请畅所欲言吧。', '准备好交流了吗？我已经就位啦。', '来到这里就可以放松聊聊啦，请讲吧。', '随时可以开始我们的对话了哦。'],
  switchSession: ['切换到新话题啦，我们重新开始。', '好的，让我们把注意力转到这个话题上。', '翻开新的一页，来看看这个主题吧。', '没问题，我们来聊聊这个新的想法。', '话题已切换，听听你这次的想法。'],
  fallback: ['遇到卡点随时发我。', '把问题写下来，我们一起拆开。'],
} as const

const getRandomText = (texts: readonly string[]) => texts[Math.floor(Math.random() * texts.length)] ?? copy.fallback[0]

function getStorage(): MascotBubbleStorage | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined
    return window.localStorage
  } catch {
    return undefined
  }
}

function hasHolidayFirstShown(dateKey: string, storage?: MascotBubbleStorage): boolean {
  const key = `${holidayFirstPrefix}${dateKey}`
  const activeStorage = storage ?? getStorage()
  if (!activeStorage && memoryStorage.has(key)) return true
  try {
    return activeStorage?.getItem(key) === '1'
  } catch {
    return memoryStorage.has(key)
  }
}

function markHolidayFirstShown(dateKey: string, storage?: MascotBubbleStorage) {
  const key = `${holidayFirstPrefix}${dateKey}`
  const activeStorage = storage ?? getStorage()
  if (!activeStorage) memoryStorage.add(key)
  try { activeStorage?.setItem(key, '1') } catch { memoryStorage.add(key) }
}

export function selectMascotBubble(context: MascotCopyContext, storage?: MascotBubbleStorage): MascotBubbleSelection {
  const holidays = context.holidayKeys.flatMap((key) => copy[key as keyof typeof copy] ?? [])
  if (holidays.length > 0 && !hasHolidayFirstShown(context.dateKey, storage)) {
    const text = getRandomText(holidays)
    markHolidayFirstShown(context.dateKey, storage)
    return { text, isHolidayFirst: true }
  }

  const candidates = [
    ...(context.aiState === 'thinking' ? copy.thinking : []),
    ...(context.aiState === 'complete' ? copy.complete : []),
    ...(context.aiState === 'error' ? copy.error : []),
    ...holidays,
    ...(context.timePeriod === 'afternoon' ? copy.afternoon : copy[context.timePeriod]),
    ...copy[context.dayType],
    ...(context.sessionKind === 'new' ? copy.newSession : copy.existingSession),
    ...(context.isListening ? copy.listening : []),
    ...(!context.isListening ? copy.inputIdle : []),
    ...(context.isContinuousClick ? copy.continuousClick : context.isFirstClick ? copy.firstClick : []),
  ]
  return { text: getRandomText(candidates.length ? candidates : copy.fallback), isHolidayFirst: false }
}

export const MASCOT_HOLIDAY_STORAGE_PREFIX = holidayFirstPrefix
