// SandBot이 아는 파일 해시(SHA-256). maven.brott.dev는 체크섬 파일(.sha1·.sha256 …)도 .module도 주지 않으므로, 지원하는
// 버전은 SandBot이 직접 받아 잰 값을 여기에 고정한다(scripts/fetch-ftc-sdk.mjs처럼). 표에 없는 버전은 처음 받은 해시를
// 기록하고(firstUse) 다음부터 다르면 거부한다. 표에 있는 파일은 어디서 읽었든(Gradle 캐시 포함) 이 값과 같아야 한다.
// maven.brott.dev는 .module을 묻지 않으므로(repositories.ts의 moduleMetadata) 받을 파일 이름과 의존성은 이 표의 POM이 정한다
// (나중에 .module이 생겨도 다른 파일·의존성으로 바뀌지 않는다).
//
// 2026-10-28에 https://maven.brott.dev/(→ acmerobotics.z13.web.core.windows.net)에서 받아 잰 값. jar·aar 값은 조사 보고
// (libs-gradle §4.7, libs-dashboard §1)의 값과 같다.

export const PINNED_SHA256: Readonly<Record<string, string>> = {
  'com.acmerobotics.roadrunner:core:1.0.1/core-1.0.1.jar':
    'a23f507bc28982be1340ce642e7494151c3ad540285093460e323a799ace8ba1',
  'com.acmerobotics.roadrunner:core:1.0.1/core-1.0.1.pom':
    '81b67b53845d9de50f9399d2482881b16b68e04c15075647d4e34075aae25efd',
  'com.acmerobotics.roadrunner:actions:1.0.1/actions-1.0.1.jar':
    '4890d81b6433499dc012a4ba718c465dc7a8f1a42ca7bb879646d27073676e00',
  'com.acmerobotics.roadrunner:actions:1.0.1/actions-1.0.1.pom':
    '4d070210e052dbdb4d94ff21b2745d02c704b5fdd93049ecd9c231891f65794c',
  'com.acmerobotics.roadrunner:ftc:0.1.25/ftc-0.1.25.aar':
    '51525131d65d809d1d9d8e0da9cf329ae6f105b3ed0412adfa23b3f7bacc05e8',
  'com.acmerobotics.roadrunner:ftc:0.1.25/ftc-0.1.25.pom':
    '1b4aeb9dd96b4f544e0b37512e3c8308d03b61ebf2831e9212c9b8577e276444',
  'com.acmerobotics.dashboard:dashboard:0.6.0/dashboard-0.6.0.aar':
    'dda97467cbe09ca5fdfefe59297d27594783c9702535694398ef13407ca8602c',
  'com.acmerobotics.dashboard:dashboard:0.6.0/dashboard-0.6.0.pom':
    '4661c074b6874172718e64557d6f19eb05cf9cf8c73ca1fb3abef1e03ffd1d0b',
  'com.acmerobotics.dashboard:core:0.6.0/core-0.6.0.jar':
    '6269019587494d5fe97c42eba06fc8653d507736de46d0a038b68fe6ab3920c5',
  'com.acmerobotics.dashboard:core:0.6.0/core-0.6.0.pom':
    '7f5c2024cdac141544740c753af77661b89a7f5c28b6f60c0a1c4b54b72e471f'
}

// 해시 표·처음 받은 해시 기록의 키
export function fileKey(group: string, artifact: string, version: string, file: string): string {
  return `${group}:${artifact}:${version}/${file}`
}
