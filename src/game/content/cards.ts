export type CardId = 'C00' | 'C01' | 'C02' | 'C03' | 'C04' | 'C05' | 'C06' | 'C07' | 'C08';
export type CardPose = 'idle' | 'search' | 'work' | 'rest' | 'cool' | 'success' | 'holiday' | 'friend' | 'perfect';

export interface CardText {
  readonly name: string;
  readonly story: string;
  readonly condition: string;
}

export interface CardDescriptor {
  readonly id: CardId;
  readonly pose: CardPose;
  readonly localized: Readonly<Record<'ko' | 'en', CardText>>;
}

// 카드 이름·이야기·조건 안내는 여기서 두 언어를 함께 편집합니다.
// 실제 해금 판정은 진행 규칙이 맡습니다. 포즈는 능력이나 제한시간을 바꾸지 않습니다.
export const CARDS = [
  {
    id: 'C00', pose: 'idle', localized: {
      ko: { name: '출근 파인더', story: '가방은 작고 부탁은 많다. 그래도 첫 인사는 늘 같다. “파일 찾는 건 나한테 맡겨!”', condition: '처음부터 함께하는 카드' },
      en: { name: 'Finder, Ready for Work', story: 'A small bag, plenty of errands, and the same first greeting: “Leave the file finding to me!”', condition: 'Available from the beginning' },
    },
  },
  {
    id: 'C01', pose: 'search', localized: {
      ko: { name: '돋보기 파인더', story: '돋보기로 보는 것은 파일만이 아니다. 함께 찾아준 손도 기억한다.', condition: '정규 1판 완주 · 성공 개수와 무관' },
      en: { name: 'Finder with a Magnifying Glass', story: 'Files are not the only things he notices. He remembers the hand that helped him look.', condition: 'Finish 1 regular run, with any number of successes' },
    },
  },
  {
    id: 'C02', pose: 'work', localized: {
      ko: { name: '책상 파인더', story: '두 번째 출근에는 작은 노트북을 가져왔다. 화면 한쪽에는 쉬는 시간도 적혀 있다.', condition: '정규 2판 완주 · 성공 개수와 무관' },
      en: { name: 'Finder at the Desk', story: 'On his second visit he brings a little laptop. A break is written into one corner of the schedule.', condition: 'Finish 2 regular runs, with any number of successes' },
    },
  },
  {
    id: 'C03', pose: 'rest', localized: {
      ko: { name: '낮잠 파인더', story: '세 번의 심부름 뒤, 파인더는 의자를 조금 뒤로 밀었다. 쉬는 모습도 이 작업실의 모습이다.', condition: '정규 3판 완주 · 성공 개수와 무관' },
      en: { name: 'Napping Finder', story: 'After three rounds of errands, Finder eases his chair back. Rest belongs in this workspace too.', condition: 'Finish 3 regular runs, with any number of successes' },
    },
  },
  {
    id: 'C04', pose: 'cool', localized: {
      ko: { name: '선글라스 파인더', story: '세 번 연속 척척. 파인더가 주머니에서 선글라스를 꺼냈다. 실내라는 사실은 잠깐 잊었다.', condition: '정규 한 판에서 3연속 성공 · 두 모드 모두 가능' },
      en: { name: 'Finder in Sunglasses', story: 'Three in a row! Finder reaches for his sunglasses, briefly forgetting that he is indoors.', condition: 'Succeed 3 times in a row in one regular run, in either mode' },
    },
  },
  {
    id: 'C05', pose: 'success', localized: {
      ko: { name: '만세 파인더', story: '일곱 개 이상의 일감이 제자리를 찾았다. 작은 팔로 크게 기뻐하는 데에는 연습이 필요 없었다.', condition: '정규 한 판에서 7/10 이상 성공 · 두 모드 모두 가능' },
      en: { name: 'Hooray, Finder!', story: 'At least seven errands found their way home. Celebrating with little arms takes no practice.', condition: 'Succeed in at least 7 of 10 errands in one regular run, in either mode' },
    },
  },
  {
    id: 'C06', pose: 'holiday', localized: {
      ko: { name: '휴가 파인더', story: '선글라스와 가방은 준비됐다. 이번에 찾으러 가는 것은 파일이 없는 시간이다.', condition: '정규 3판 완주 후 휴가신청서.txt에서 휴가 승인' },
      en: { name: 'Finder on Holiday', story: 'Sunglasses and bag, ready. This time he is looking for a little time without files.', condition: 'Finish 3 regular runs, then approve Holiday_request.txt' },
    },
  },
  {
    id: 'C07', pose: 'friend', localized: {
      ko: { name: '발견 친구 파인더', story: '선물 폴더 안에는 정답이 없었다. 대신 다음에 같이 찾아도 좋겠다는 마음이 있었다.', condition: '휴가 승인 뒤 정규 1판 추가 완주 → 오늘_찾은_것.txt 확인 · 어느 선택이든 가능' },
      en: { name: 'Finder, a Friend Found', story: 'The gift folder held no correct answer. It held an invitation to look together again sometime.', condition: 'Finish a new regular run after holiday approval, then confirm Things_found_today.txt with either choice' },
    },
  },
  {
    id: 'C08', pose: 'perfect', localized: {
      ko: { name: '별빛 파인더', story: '열 가지 부탁이 모두 제자리를 찾자, 작은 별빛이 파인더 곁에 내려앉았다. “오늘은 우리 둘 다 반짝였네!”', condition: '정규 한 판을 10/10 모두 성공하며 완주 · 두 모드 모두 가능' },
      en: { name: 'Starlight Finder', story: 'When all ten errands found their place, a little starlight settled beside Finder. “We both shone today!”', condition: 'Finish one regular run with all 10 of 10 successes, in either mode' },
    },
  },
] as const satisfies readonly CardDescriptor[];
