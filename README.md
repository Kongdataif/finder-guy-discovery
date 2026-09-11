# 파인더야, 그것 좀 찾아줘!

파인더 가이와 작은 책상 위의 파일을 찾고 정리하는 브라우저 게임입니다. 마우스와 터치로 플레이하며, 한국어와 영어를 지원합니다.

- 정규 10미션과 조작을 익히는 3미션 연습
- 보통·느긋하게 두 가지 속도
- 함께할 파인더 카드 9종과 파인더별 인사·미션 대사
- 결과에서 선택해 읽는 ‘오늘의 발견’과 작은 이야기
- 게임용 배경음악·효과음, 음소거·일시정지

처음에는 대기 화면의 **게임 안내**나 **조작 연습**을 열어 보세요. 실패해도 다음 미션으로 이어지며, 이야기를 읽지 않고 다시 시작할 수도 있습니다. 휴대폰 플레이는 가로 화면을 권장하고, 게임 안내는 세로 화면에서도 읽을 수 있습니다.

## 로컬 실행

Node.js **24**와 npm을 사용합니다.

```sh
npm ci
npm run dev
```

개발 서버는 http://127.0.0.1:5174/ 에서 열립니다.

## 검사와 빌드

```sh
npm run test
npm run build
npm run preview
```

빌드 결과는 `dist/`에 만들어집니다. 프리뷰 주소는 http://127.0.0.1:4174/ 입니다.

브라우저 검사는 개발 서버를 켠 뒤 별도 터미널에서 실행합니다.

```sh
npx playwright install chromium webkit
npm run smoke
npm run test:devices
```

다른 서버를 검사할 때는 `FINDER_BASE_URL`을 지정합니다. 자동 기기 프로필 검사는 실제 휴대폰에서의 사용감 확인과 별개입니다.

같은 Wi-Fi의 휴대폰에서 빌드 결과를 열려면 `npm run build` 후 `npm run preview:phone`을 실행하고, 터미널에 표시되는 Network 주소를 사용하세요. Mac과 프리뷰 서버가 켜져 있어야 합니다.

## Netlify 배포

GitHub에 이 프로젝트를 올린 뒤 Netlify에서 **Add new project → Import an existing project → GitHub**를 선택하고 해당 저장소를 연결합니다. [Netlify 공식 연결 안내](https://docs.netlify.com/start/quickstarts/deploy-from-repository/)

다음 값으로 연결합니다. 빌드 명령·공개 폴더·Node 버전은 [netlify.toml](netlify.toml)에 지정되어 있습니다.

| 설정 | 값 |
| --- | --- |
| Production branch | `main` |
| Base directory | 저장소 최상위 — 비워 두기 |
| Build command | `npm run test && npm run build` |
| Publish directory | `dist` |
| Node.js | `24` |

배포가 성공하면 Netlify에서 제공하는 게임 주소를 확인합니다. 사이트가 Private인 경우 공유할 때 **Make public**을 선택합니다. 이후 `main`에 변경을 올리면 같은 사이트가 갱신됩니다. [공개 설정](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/), [자동 배포](https://docs.netlify.com/deploy/create-deploys/)

## 소스 구성

| 경로 | 내용 |
| --- | --- |
| [`src/game/core/`](src/game/core/) | 미션 규칙·판정·타이머 |
| [`src/game/scenes/`](src/game/scenes/), [`src/game/ui/`](src/game/ui/) | 게임 화면과 UI |
| [`src/game/content/`](src/game/content/), [`src/game/i18n/`](src/game/i18n/) | 편집 가능한 이야기·파인더 대사·한국어/영어 문구 |
| [`src/game/progress/`](src/game/progress/) | 카드·이야기 진행과 저장 |
| [`src/game/music.ts`](src/game/music.ts), [`Sound.ts`](src/game/Sound.ts) | 배경음악 음표와 Web Audio 재생 |
| [`public/assets/finder/`](public/assets/finder/) | 파인더 이미지 |
| [`tools/`](tools/) | 브라우저 검사 도구 |

Phaser, TypeScript, Vite를 사용합니다. 게임은 브라우저 안에서 실행하며 별도 서버나 API 키가 필요 없습니다. 음악·이미지·폰트는 게임에 포함됩니다.

진행 기록과 설정은 현재 브라우저에 저장됩니다. 기기·브라우저·사이트 주소가 다르면 기록이 별개이며, 로컬 플레이 기록은 배포한 사이트로 자동 이전되지 않습니다. 음악은 첫 조작 뒤 시작하며 게임 설정에서 끌 수 있습니다.

이 저장소에는 README와 게임·검사 코드, 이미지, 실행·빌드·배포 설정을 포함합니다. 제작 기획서와 내부 작업 문서는 업로드 대상에서 제외합니다.
