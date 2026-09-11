export type TopicId = 'organize' | 'create' | 'rest';

export interface DiscoveryText {
  readonly title: string;
  readonly topic: string;
  readonly paragraphs: readonly string[];
  readonly suggestion: string;
  readonly finderLine: string;
}

export interface Discovery {
  readonly id: string;
  readonly topicId: TopicId;
  readonly recordsAction: boolean;
  readonly sourceType: 'original';
  readonly localized: Readonly<Record<'ko' | 'en', DiscoveryText>>;
}

// 편집 안내: 발견 본문은 이 파일에서 한국어와 영어를 함께 수정합니다.
// paragraphs의 각 항목은 화면에서 하나의 문단으로 표시됩니다.
// D02의 한국어 글과 파인더 한 줄은 기획서 9.3의 원문을 유지합니다.
// 작은 제안은 사용자가 자기 메모 앱에서 선택해 보는 행동입니다.
// 이 데이터에는 점수, 해금, 읽음 상태, 메모 입력 또는 저장 규칙을 넣지 않습니다.
const D02 = {
  id: 'D02',
  topicId: 'create', recordsAction: true, sourceType: 'original',
  localized: {
    ko: {
      title: '아직 이름 없는 한 줄',
      topic: '창작',
      paragraphs: [
        '파인더는 빈 문서를 발견했다. 오류는 아니었다. 아직 제목이 없을 뿐이었다.',
        '무엇을 쓸지 정해지지 않아도 파일은 열릴 수 있었다. 파인더는 첫 줄에 작은 점을 하나 찍었다. 시작한 흔적만큼은 분명했다.',
      ],
      suggestion: '마음이 가면 자기 메모 앱에 지금 떠오르는 문장 하나를 남겨 보세요.',
      finderLine: '제목은 나중에 찾아도 되지.',
    },
    en: {
      title: 'A Line Without a Name Yet',
      topic: 'Creativity',
      paragraphs: [
        'Finder found an empty document. It wasn’t an error. It simply didn’t have a title yet.',
        'The file could open even before there was a plan for what to write. Finder placed a little dot on the first line. There was at least one clear sign that a start had been made.',
      ],
      suggestion: 'If you feel like it, leave one sentence that comes to mind in your own notes app.',
      finderLine: 'We can find a title later.',
    },
  },
} as const satisfies Discovery;

/** All prose is original game writing. IDs and topic IDs are stable save keys. */
export const DISCOVERIES = [
  {
    id: 'D01', topicId: 'organize', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '최종이 세 개가 된 날', topic: '정리',
        paragraphs: [
          '폴더에는 최종이 세 개 있었다. 파인더는 가장 힘주어 쓴 이름 대신, 마지막으로 바뀐 시간을 살폈다. 파일을 찾고 나서 작은 메모를 붙였다. “다음의 나에게: 이 파일이 맞습니다.”',
          '오늘은 폴더 전체를 정리하지 않아도 된다. 다시 찾을 하나만 알아볼 수 있으면 된다.',
        ],
        suggestion: '마음이 가면 나중에 다시 찾을 파일 하나에 알아볼 수 있는 이름을 붙여 보세요. 실제 변경은 자기 환경에서 직접 할 수 있어요. 게임은 파일에 접근하지 않아요.',
        finderLine: '이번에는 미래의 네가 덜 헤매겠네.',
      },
      en: {
        title: 'The Day There Were Three Finals', topic: 'Organizing',
        paragraphs: [
          'There were three files called final. Finder checked when they last changed, instead of trusting the most emphatic name. After finding the right one, he left a little note: “Dear future me: this is the file.”',
          'The whole folder didn’t have to be tidy today. It was enough to recognize one thing he would want to find again.',
        ],
        suggestion: 'If you like, give one file you will need again a recognizable name in your own workspace. This game never accesses your files.',
        finderLine: 'Your future self may wander a little less now.',
      },
    },
  },
  D02,
  {
    id: 'D03', topicId: 'rest', recordsAction: false, sourceType: 'original',
    localized: {
      ko: {
        title: '오늘은 찾지 않기로', topic: '쉬어가기',
        paragraphs: [
          '파인더가 돋보기를 내려놓았다. 바탕화면에는 아직 파일이 있었지만, 모두 오늘 찾아야 하는 것은 아니었다.',
          '빈 의자를 하나 꺼내 놓고 새 메모를 만들었다. “지금은 아무것도 검색하지 않는 중.” 그 메모에는 완료 버튼이 없었다.',
        ],
        suggestion: '마음이 가면 화면 밖에서 파란 물건 하나를 찾아보세요. 찾지 않아도 괜찮아요.',
        finderLine: '이건 기록하지 않을게.',
      },
      en: {
        title: 'No Searching Today', topic: 'Taking a break',
        paragraphs: [
          'Finder put down his magnifying glass. Files remained on the desktop, but they didn’t all need to be found today.',
          'He brought out an empty chair and made a note: “Currently searching for nothing.” The note had no done button.',
        ],
        suggestion: 'If you feel like it, notice one blue thing away from the screen. It is also okay not to look.',
        finderLine: 'I won’t keep a record of this one.',
      },
    },
  },
  {
    id: 'D04', topicId: 'organize', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '돌아올 자리가 있는 연필', topic: '정리',
        paragraphs: [
          '파인더는 연필을 세 번 찾았다. 첫 번째는 노트 뒤, 두 번째는 찻잔 옆, 세 번째는 자기 손 안이었다. 연필은 도망친 적이 없다고 했다.',
          '파인더는 책상 한쪽에 작은 선을 그었다. 이제 연필에게는 돌아올 자리가 있었다. 책상 전체를 바꾸지는 않았다.',
        ],
        suggestion: '자주 찾는 물건 하나의 돌아올 자리를 정해 보세요. 오늘은 그 물건 하나면 충분해요.',
        finderLine: '주소가 있으면 찾기가 쉽지.',
      },
      en: {
        title: 'A Place for a Pencil to Return', topic: 'Organizing',
        paragraphs: [
          'Finder looked for his pencil three times: behind a notebook, beside a cup, and finally in his own hand. The pencil insisted it had never run away.',
          'He drew a little line at one edge of the desk. The pencil now had a place to return. The rest of the desk stayed as it was.',
        ],
        suggestion: 'Choose a returning place for one thing you often look for. One thing is enough for today.',
        finderLine: 'An address makes finding things easier.',
      },
    },
  },
  {
    id: 'D05', topicId: 'organize', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '미분류도 하나의 자리', topic: '정리',
        paragraphs: [
          '어느 폴더에도 딱 맞지 않는 종이가 한 장 있었다. 파인더는 폴더 이름을 여섯 개나 적었다가 모두 지웠다.',
          '마지막에는 “아직 정하지 않음”이라고 썼다. 종이를 잃어버리지 않고 잠시 둘 수 있는 자리였다. 분류를 미루자 책상에는 작은 빈틈이 생겼다.',
        ],
        suggestion: '분류가 어려운 항목 하나에 임시 자리를 만들어 보세요. 바로 이름을 정하지 않아도 괜찮아요.',
        finderLine: '아직은, 여기도 괜찮겠네.',
      },
      en: {
        title: 'Unsorted Is a Place Too', topic: 'Organizing',
        paragraphs: [
          'One sheet didn’t quite belong in any folder. Finder wrote six possible folder names, then erased them all.',
          'At last he wrote “Not decided yet.” It was a place to leave the sheet without losing it. Putting the decision aside made a little space on the desk.',
        ],
        suggestion: 'Make a temporary place for one thing that is hard to sort. Its final label can wait.',
        finderLine: 'For now, here will do.',
      },
    },
  },
  {
    id: 'D06', topicId: 'organize', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '내일의 나에게 남긴 화살표', topic: '정리',
        paragraphs: [
          '파인더는 작업을 멈추기 전에 메모를 한 장 붙였다. “다음에는 파란 봉투부터.” 다 끝냈다는 표시 대신 다음에 손댈 곳을 적은 것이다.',
          '다시 돌아왔을 때, 파인더는 처음부터 기억을 뒤지지 않았다. 짧은 화살표 하나가 어제와 오늘을 이어 주었다.',
        ],
        suggestion: '하던 일을 잠시 멈춘다면 다음에 할 작은 한 가지를 적어 두어도 좋아요.',
        finderLine: '돌아올 때의 나도 손님이니까.',
      },
      en: {
        title: 'An Arrow for Tomorrow', topic: 'Organizing',
        paragraphs: [
          'Before stopping work, Finder left a note: “The blue envelope next.” It didn’t say everything was finished. It simply pointed to where he might begin again.',
          'When he returned, he didn’t have to search his memory from the start. One little arrow connected yesterday to today.',
        ],
        suggestion: 'When you pause something, you can leave a note naming one small next step.',
        finderLine: 'The me who comes back deserves a welcome too.',
      },
    },
  },
  {
    id: 'D07', topicId: 'create', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '동그라미가 의자가 되기까지', topic: '창작',
        paragraphs: [
          '파인더는 동그라미를 그리려다 옆으로 긴 모양을 만들었다. 지우개를 찾던 손이 잠깐 멈췄다. 다리 두 개를 붙이니 작은 의자가 되었다.',
          '의자는 조금 기울었지만 파인더의 그림 속에서는 잘 서 있었다. 처음 생각한 모양과 다른 것도 자리를 가질 수 있었다.',
        ],
        suggestion: '종이에 간단한 모양 하나를 그리고, 떠오르는 것을 하나만 덧붙여 보세요.',
        finderLine: '계획에는 없었지만 앉을 수 있겠어.',
      },
      en: {
        title: 'How a Circle Became a Chair', topic: 'Creativity',
        paragraphs: [
          'Finder tried to draw a circle and made something long and lopsided. His hand paused on its way to the eraser. With two legs added, the shape became a little chair.',
          'It leaned a bit, but it stood perfectly well inside his drawing. Something different from the original plan could have a place too.',
        ],
        suggestion: 'Draw one simple shape on paper, then add just one thing that comes to mind.',
        finderLine: 'Not in the plan, but I could sit here.',
      },
    },
  },
  {
    id: 'D08', topicId: 'create', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '작은 제목 가게', topic: '창작',
        paragraphs: [
          '파인더는 평범한 찻잔 사진에 “구름 한 모금”이라는 제목을 붙였다. 찻잔은 그대로였지만 사진을 다시 보게 되었다.',
          '그다음 제목은 “아직 따뜻함”이었다. 어느 쪽도 정답은 아니었다. 파인더는 둘 다 작은 종이에 남겨 두었다.',
        ],
        suggestion: '눈앞의 물건 하나에 장난스러운 제목을 붙여 보세요. 마음속으로만 붙여도 좋아요.',
        finderLine: '오늘은 이름 짓는 쪽이 손님이네.',
      },
      en: {
        title: 'The Little Title Shop', topic: 'Creativity',
        paragraphs: [
          'Finder titled an ordinary photo of a cup “A Sip of Cloud.” The cup hadn’t changed, but he looked at it again.',
          'His next title was “Still Warm.” Neither was the correct answer. He kept both on a little piece of paper.',
        ],
        suggestion: 'Give one nearby object a playful title. You can keep the title entirely in your head.',
        finderLine: 'Today, naming things is the visitor.',
      },
    },
  },
  {
    id: 'D09', topicId: 'create', recordsAction: true, sourceType: 'original',
    localized: {
      ko: {
        title: '끝나지 않은 문장의 산책', topic: '창작',
        paragraphs: [
          '파인더는 “문을 열자”까지만 쓰고 밖을 보았다. 다음에는 바다가 나올 수도, 잃어버린 양말이 나올 수도 있었다.',
          '오늘은 어느 문도 고르지 않았다. 문장이 잠깐 열려 있는 것도 나쁘지 않았다. 작은 점 옆에 다음 날의 자리를 비워 두었다.',
        ],
        suggestion: '“문을 열자” 뒤에 생각나는 말 몇 개를 붙여 보세요. 끝까지 쓰지 않아도 괜찮아요.',
        finderLine: '다음 줄은 산책 중이래.',
      },
      en: {
        title: 'A Walk for an Unfinished Sentence', topic: 'Creativity',
        paragraphs: [
          'Finder wrote “When I opened the door” and looked outside. The next words might reveal an ocean, or a missing sock.',
          'Today he chose neither door. Leaving the sentence open for a while felt fine. Beside a little dot, he left room for another day.',
        ],
        suggestion: 'Add a few words after “When I opened the door.” The sentence does not need an ending yet.',
        finderLine: 'The next line has gone for a walk.',
      },
    },
  },
  {
    id: 'D10', topicId: 'rest', recordsAction: false, sourceType: 'original',
    localized: {
      ko: {
        title: '빈 의자도 준비물', topic: '쉬어가기',
        paragraphs: [
          '파인더의 준비물 목록에는 가방, 안경, 그리고 빈 의자가 있었다. 어디에 쓰느냐고 묻자 그는 먼저 앉아 보였다.',
          '아무 설명도 이어지지 않았다. 잠깐 뒤, 의자 옆으로 햇빛이 한 칸 움직였다. 그것이 그 시간에 일어난 전부였다.',
        ],
        suggestion: '편한 자리에 잠시 앉아 있어도 좋아요. 특별한 생각을 하지 않아도 괜찮아요.',
        finderLine: '이번 준비물은 이미 준비됐어.',
      },
      en: {
        title: 'An Empty Chair Counts as Supplies', topic: 'Taking a break',
        paragraphs: [
          'Finder’s supplies list included a bag, glasses, and an empty chair. Asked what the chair was for, he simply sat down.',
          'No explanation followed. After a while, the sunlight shifted a little beside the chair. That was everything that happened during that time.',
        ],
        suggestion: 'You can sit somewhere comfortable for a moment. There is no special thought you need to have.',
        finderLine: 'This part of the preparation is already ready.',
      },
    },
  },
  {
    id: 'D11', topicId: 'rest', recordsAction: false, sourceType: 'original',
    localized: {
      ko: {
        title: '창밖에는 폴더가 없어서', topic: '쉬어가기',
        paragraphs: [
          '파인더는 창밖의 구름을 어느 폴더에 넣을지 생각했다. 사진도 문서도 아니고, 금방 모양이 달라졌다.',
          '결국 창을 열어 두기로 했다. 구름은 저장하지 않아도 지나갔다. 파인더는 이름표 없는 것들을 잠깐 바라보았다.',
        ],
        suggestion: '마음이 가면 화면에서 시선을 떼고 먼 곳을 잠깐 바라보세요. 무엇을 찾아야 하는 시간은 아니에요.',
        finderLine: '여기는 분류하지 않아도 되는구나.',
      },
      en: {
        title: 'There Are No Folders Outside', topic: 'Taking a break',
        paragraphs: [
          'Finder wondered which folder could hold the cloud outside his window. It wasn’t a photo or a document, and its shape kept changing.',
          'He decided to leave the window open. The cloud passed without being saved. For a while, Finder watched things without labels.',
        ],
        suggestion: 'If you feel like it, look away from the screen toward something farther away. There is nothing you need to find.',
        finderLine: 'Nothing needs sorting here.',
      },
    },
  },
  {
    id: 'D12', topicId: 'rest', recordsAction: false, sourceType: 'original',
    localized: {
      ko: {
        title: '오늘의 마지막 저장은 빈칸', topic: '쉬어가기',
        paragraphs: [
          '파인더는 하루 끝에 오늘 한 일을 적으려다 종이를 접었다. 적지 않아도 이미 지나온 하루였다.',
          '작은 가방에는 아무것도 더 넣지 않았다. 가벼운 가방을 들고 문 앞에 섰다. 빈칸 하나가 조용히 함께 나왔다.',
        ],
        suggestion: '지금은 아무 기록도 남기지 않고 넘어가도 좋아요. 이 제안에는 완료 표시가 없어요.',
        finderLine: '빈칸도 데리고 갈게.',
      },
      en: {
        title: 'The Last Save Is a Blank Space', topic: 'Taking a break',
        paragraphs: [
          'At the end of the day, Finder started to list what he had done, then folded the paper. It had still been a day, even without a list.',
          'He added nothing to his little bag. Standing by the door with a lighter bag, he found that one blank space had quietly come along.',
        ],
        suggestion: 'You can move on without leaving a record. This suggestion has no completion mark.',
        finderLine: 'I’ll bring the blank space too.',
      },
    },
  },
] as const satisfies readonly Discovery[];

/** Kept for the single-reader entry point; matching uses DISCOVERIES. */
export const TODAY_DISCOVERY: Discovery = D02;
