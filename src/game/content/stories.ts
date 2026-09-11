export type StoryId = 'H01' | 'H02';
export type StoryLines = readonly [string, string, string];

export interface StoryText {
  readonly title: string;
  readonly fileText: readonly string[];
  readonly scenes: StoryLines;
  readonly restScenes?: StoryLines;
  readonly continueScenes?: StoryLines;
}

export interface StoryDescriptor {
  readonly id: StoryId;
  readonly cardId: 'C06' | 'C07';
  readonly durationMs: number;
  readonly localized: Readonly<Record<'ko' | 'en', StoryText>>;
}

// 이야기 문구는 이 파일에서 편집합니다. 해금·선택 저장·보상은 진행 규칙이 맡습니다.
// H02의 {files}에는 실제로 처리한 게임 속 가상 파일 이름만 표시합니다.
// 두 선택 모두 같은 이야기 완료입니다. 실제 창을 닫거나 기다리게 하지 않습니다.
export const STORIES: Readonly<Record<StoryId, StoryDescriptor>> = {
  H01: {
    id: 'H01', cardId: 'C06', durationMs: 8_000,
    localized: {
      ko: {
        title: '휴가신청서.txt',
        fileText: ['가고 싶은 곳: 파일이 없는 곳 / 준비물: 선글라스 / 복귀일: 아직 정하지 않음.'],
        scenes: [
          '파인더가 선글라스를 꺼내 쓴다. 가방은 생각보다 가볍다.',
          '책상 옆 작은 문을 열고, 잠시 뒤를 돌아본다.',
          '찾아줘서 고마워. 이번에는 내 시간이었네.',
        ],
      },
      en: {
        title: 'Holiday_request.txt',
        fileText: ['Destination: somewhere without files / Supplies: sunglasses / Return date: not decided yet.'],
        scenes: [
          'Finder puts on his sunglasses. His bag is lighter than he expected.',
          'He opens the little door beside the desk, then looks back for a moment.',
          'Thanks for finding it. This time, it was time for me.',
        ],
      },
    },
  },
  H02: {
    id: 'H02', cardId: 'C07', durationMs: 6_000,
    localized: {
      ko: {
        title: '오늘_찾은_것.txt',
        fileText: ['함께 처리한 게임 속 파일', '{files}', '내가 찾은 것: 같이 찾아준 친구 한 명.'],
        scenes: ['파인더가 작은 선물 폴더를 꺼낸다.', '폴더 맨 뒤에는 파일 이름이 아닌 문장이 적혀 있다.', '내가 찾은 것: 같이 찾아준 친구 한 명.'],
        restScenes: ['파인더가 옆에 의자를 하나 더 놓는다.', '둘은 정리된 책상 곁에 잠시 앉아 쉰다.', '오늘은 여기까지. 함께 찾아줘서 고마워.'],
        continueScenes: ['파인더가 선물 폴더를 건넨다.', '다음 심부름을 놓을 자리를 조금 비워 둔다.', '한 판 더 함께하자. 준비되면 시작해!'],
      },
      en: {
        title: 'Things_found_today.txt',
        fileText: ['Pretend files we handled together', '{files}', 'What I found: one friend who helped me look.'],
        scenes: ['Finder takes out a little gift folder.', 'At the back is a sentence instead of a file name.', 'What I found: one friend who helped me look.'],
        restScenes: ['Finder places another chair beside his.', 'Together, you sit by the tidy desk for a little break.', 'That’s enough for today. Thanks for looking with me.'],
        continueScenes: ['Finder offers you the gift folder.', 'He clears a little space for the next errand.', 'Let’s share another run. Start when you’re ready!'],
      },
    },
  },
} as const;
