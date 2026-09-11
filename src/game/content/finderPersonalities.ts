import type { CardId } from "./cards";
import type { MissionKind } from "../core/types";

type Lines = readonly [string, string, string, string, string, string, string];
type Personality = { greeting: string; missions: Readonly<Record<MissionKind, string>> };
const text = (greeting: string, lines: Lines): Personality => ({ greeting, missions: {
  find: lines[0], sort: lines[1], wipe: lines[2], latest: lines[3], bundle: lines[4], catch: lines[5], boss: lines[6],
} });

// 순서: 찾기, 분류, 닦기, 최신본, 묶기, 받기, 종합 미션.
// 파인더별 인사와 시작 전 대사만 바꿉니다. 정답·시간·해금 규칙에는 영향을 주지 않습니다.
export const FINDER_PERSONALITIES: Readonly<Record<CardId, Readonly<Record<"ko" | "en", Personality>>>> = {
  C00: {
    ko: text("첫 심부름도 함께하면 괜찮아!", ["오늘의 사진부터 찾아볼까?", "파일에게 집을 찾아주자.", "안경이 조금 흐릿하네!", "이름보다 시간을 살펴볼게.", "사진끼리 나란히 놓자.", "내가 아래에서 기다릴게!", "하나씩 끝까지 해보자."]),
    en: text("First errand? We can do it together!", ["Shall we find that photo?", "Let's give each file a home.", "My glasses look a little cloudy!", "I'll check the time, not the name.", "Let's put the photos together.", "I'll wait down below!", "One step at a time."]),
  },
  C01: {
    ko: text("작은 단서도 놓치지 않을게.", ["돋보기 준비 완료!", "모양에 단서가 숨어 있어.", "단서보다 얼룩이 먼저 보이네.", "마지막으로 바뀐 흔적을 찾자.", "서로 닮은 사진을 찾아보자.", "내려오는 길을 잘 살펴볼게.", "단서를 차례대로 따라가자."]),
    en: text("Even tiny clues matter to me.", ["Magnifying glass, ready!", "The shapes hold a clue.", "I found smudges before clues.", "Let's find the latest change.", "Look for the matching photos.", "I'll watch the falling path.", "Follow the clues in order."]),
  },
  C02: {
    ko: text("책상에 네 자리도 비워 뒀어.", ["책상 위 사진을 찾아보자.", "정리하면 작업할 자리가 생겨.", "안경부터 깨끗하게 준비하자.", "내 작업 메모에는 시간이 중요해.", "사진 두 장을 한 묶음으로!", "받은 파일은 책상에 둘게.", "작은 작업을 세 번 이어가자."]),
    en: text("I saved you a place at the desk.", ["Let's find the photo on the desk.", "Sorting makes room to work.", "Clean glasses, clear start.", "My work notes depend on the time.", "Two photos, one bundle!", "I'll keep the files on my desk.", "Three little jobs in a row."]),
  },
  C03: {
    ko: text("쉬엄쉬엄, 네 속도로 함께하자.", ["눈을 비비고 사진을 찾아볼게.", "이것만 제자리에 놓아볼까?", "안경도 잠깐 씻고 싶었나 봐.", "졸려도 시간은 확인할게.", "폭신한 사진 묶음이 되겠네.", "이번에는 두 손으로 받을게!", "차근차근 하고 잠깐 쉬자."]),
    en: text("Let's take this at your pace.", ["A little stretch, then a photo.", "Shall we put these away?", "My glasses could use a wash.", "Sleepy, but I'll check the time.", "A cozy little photo bundle.", "Both hands ready this time!", "Step by step, then a little rest."]),
  },
  C04: {
    ko: text("선글라스 너머로도 잘 보이지.", ["멋지게 사진부터 찾아볼까?", "정리도 멋의 일부니까.", "선글라스에도 얼룩은 생겨.", "멋진 이름보다 최신 시간이야.", "두 장을 멋지게 한 묶음으로.", "가볍게 이동해서 받아볼게.", "멋보다 순서, 잊지 않을게."]),
    en: text("I can see just fine behind these shades.", ["Let's find that photo in style.", "A tidy desk has style too.", "Even sunglasses get smudged.", "The newest time beats a fancy name.", "Two photos, one stylish bundle.", "Slide over and catch it.", "Order first, style second."]),
  },
  C05: {
    ko: text("작은 성공에도 두 팔 번쩍!", ["사진을 찾으면 같이 기뻐하자.", "제자리를 찾는 순간이 좋아.", "반짝이면 두 팔을 들 거야!", "최신 파일도 찾을 수 있어.", "두 장이면 기쁨도 두 배네.", "들었던 팔로 파일도 받을게.", "마지막까지 함께 응원할게!"]),
    en: text("Little wins deserve both arms up!", ["We'll cheer when we find it.", "I love seeing things find a home.", "Clean lenses make me cheer!", "We can find the newest one.", "Two photos, twice the joy.", "These raised arms can catch too.", "I'll cheer you on to the end!"]),
  },
  C06: {
    ko: text("여행 가방에 여유도 챙겨 왔어.", ["여행 사진처럼 찾아보자.", "짐을 정리하듯 하나씩.", "풍경이 잘 보이게 닦아줘.", "출발 시간처럼 꼼꼼하게 보자.", "사진 두 장을 가방에 챙기듯.", "짐을 받듯 손을 뻗어볼게.", "마지막 짐까지 차근차근."]),
    en: text("I packed a little breathing room.", ["Like finding a holiday photo.", "One item at a time, like packing.", "Clean lenses for a better view.", "Check it like a departure time.", "Two photos to take along.", "I'll reach out like catching a bag.", "One last bit of packing."]),
  },
  C07: {
    ko: text("오늘도 같이 찾아줘서 반가워.", ["친구와 찾으면 더 반가운 사진.", "네가 찾으면 내가 기억할게.", "덕분에 네 얼굴이 잘 보여.", "가장 최근의 추억부터 보자.", "함께할 사진 두 장을 골라줘.", "놓칠 것 같으면 같이 움직이자.", "이번 심부름도 한 팀이야."]),
    en: text("I'm glad we're looking together again.", ["Photos are nicer to find together.", "You find it; I'll remember it.", "Now I can see my friend clearly.", "Let's find the newest memory.", "Choose two photos to share.", "We'll move together to catch it.", "We're a team for this errand too."]),
  },
  C08: {
    ko: text("열 번의 반짝임을 기억하고 있어.", ["별빛처럼 또렷하게 살펴볼게.", "파일마다 빛날 자리가 있어.", "별처럼 맑게 닦아볼까?", "가장 최근에 반짝인 시간을 보자.", "사진 두 장을 별자리처럼 잇자.", "이번에는 떨어지는 파일을 받을게.", "오늘도 한 단계씩 반짝여 보자."]),
    en: text("I remember all ten little sparks.", ["Like finding a tiny star in a photo.", "Every file has a place to shine.", "Shall we make these star-clear?", "Find the most recent little sparkle.", "Join two photos like a constellation.", "This time we're catching files.", "One bright little step at a time."]),
  },
};
