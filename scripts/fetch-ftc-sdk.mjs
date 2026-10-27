// 가짜 FTC SDK 빌드(scripts/build-sidecar.mjs)에 쓰는 실제 SDK를 받는다. 받은 것은 sidecar/build/(gitignore)에 두고
// git에 넣지 않는다. 해시는 이 파일에 고정했고, 이미 있고 해시가 맞으면 다시 받지 않는다.
// - Maven Central의 org.firstinspires.ftc:{RobotCore,Hardware,FtcCommon,Vision}:12.0.0 AAR → 안의 classes.jar를
//   sidecar/build/ftc-sdk/12.0.0/<이름>.jar로(AAR의 libs/*.jar는 libs/로)
// - com.google.android:android:4.1.1.4 jar(안드로이드 API 껍데기, stub 생성기가 형식 이름·종류를 읽는다)
// - 호환 테스트용 FtcRobotController v12.0 샘플(고정 커밋, 파일마다 SHA-256) → sidecar/build/ftc-samples/12.0/
//
// 사용법: node scripts/fetch-ftc-sdk.mjs [--no-samples]
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1로 HTTPS_PROXY를 쓰게 한다(Node 22.21 이상).
// Maven Central은 가끔 429를 준다: 네트워크 오류·429·5xx는 기다렸다가(지수) 다시 받는다.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SDK_VERSION = '12.0.0'
export const ftcSdkDir = join(repoRoot, 'sidecar', 'build', 'ftc-sdk')
export const samplesDir = join(repoRoot, 'sidecar', 'build', 'ftc-samples', '12.0')

const MAVEN = 'https://repo1.maven.org/maven2'

// AAR의 SHA-256(Maven Central 12.0.0)
const AARS = [
  ['RobotCore', '9962d23f3c17de03f93ae7509ddab7a92fdccd9acdcf9d7bf9d3de0b5f0ee3eb'],
  ['Hardware', 'aac18059bb25bcd839c2ecd58b1cd3a320a9deec7515ab1182fc0b02b9b19613'],
  ['FtcCommon', '9a59782b3c1e25d627134b65314a8f5ed1b97e8cc3a711269e86a0d5fbc7da2a'],
  ['Vision', '96a2a8d0c1071612d1656dcf6e90dafc3863ec1f31a5017152e2f66725a536f4']
]

const ANDROID_JAR = {
  url: `${MAVEN}/com/google/android/android/4.1.1.4/android-4.1.1.4.jar`,
  sha256: '84072541cbb711eff89f7277100ff854929a446dba7ceb1b195c340e0b4fd3cb',
  file: 'android-4.1.1.4.jar'
}

// FtcRobotController v12.0 태그의 커밋과 샘플 파일(external/samples 아래 경로)의 SHA-256
const SAMPLES_COMMIT = 'e14c2aeb33e84d4ea21697beeea9ac49557be870'
const SAMPLES_PATH = 'FtcRobotController/src/main/java/org/firstinspires/ftc/robotcontroller/external/samples'
const SAMPLES = [
  ['BasicOmniOpMode_Linear.java', '9d53be174a1b150000486ac3f67894144917ac7a62f15b65565dca2ca571098a'],
  ['BasicOpMode_Iterative.java', 'c7318e6f209343cf3c222ce51b5f2e29c9b30e785792452db2320251e25e9cf7'],
  ['BasicOpMode_Linear.java', '0535c566dff06b3692606f9cee4c4b175281b9c7e9e9876fb64dceabdaa0c354'],
  ['ConceptAprilTag.java', '9f2cfbc2875d64d69a65228000f8ad76632458cefa139344dcdc6028d7c3c33e'],
  ['ConceptAprilTagEasy.java', '8c5dcfae1c2ee65818394932ef34108b3f9cf8cdce9705cfc220533a022fc25c'],
  ['ConceptAprilTagLocalization.java', '58facab1b609fc69104f0b22c97c93152fb134e29c1a56b13caf03e97f000557'],
  ['ConceptAprilTagMultiPortal.java', '3d2b0a07593d58d1f387e4aad4893405602679f67f781993f4b577463b7ca127'],
  [
    'ConceptAprilTagOptimizeExposure.java',
    'fd2a60a73c6ccb0e257cedc36cc5b05a9a11d78d0bb19d17f3f6d49c3e5c3b4d'
  ],
  [
    'ConceptAprilTagSwitchableCameras.java',
    '009e314f38c89da7c774b114bf1df230c6cd34379a5f5a84a6bc51e8d4d31f15'
  ],
  ['ConceptBlackboard.java', 'ee10179ab6a596cd23e05dfa9f68fe9eba147963fa4a7fc4a821a867d242a1fe'],
  [
    'ConceptExploringIMUOrientation.java',
    '7690ddfb66c8e3d5cf4d1fbbcbd5bc8511fe750dcf770e44458f666a171f776f'
  ],
  ['ConceptGamepadEdgeDetection.java', 'ff8c93708bc464cfe32946005bc22bcd632cf0a4d2aac7e90cc7b1762477e15c'],
  ['ConceptGamepadRumble.java', '7475e2792d5c312da49f824a11957cdfe724683007df024cecca0e4992ae8195'],
  ['ConceptGamepadTouchpad.java', 'fda4aeb6569512c097bb4f96434b0a03e883f0b856f1f9f38ec14de90a55d0d2'],
  ['ConceptLEDStick.java', '780d4a80585c6f2fcf5744687acab72331cee4dcb0c944098ee0f96ddd0678ad'],
  ['ConceptMotorBulkRead.java', 'deba5e896ed2b9e01a6ad8fb00f4533a5838c517e58da0b9b2d175c4fe47ee1d'],
  ['ConceptNullOp.java', '50bd665dc1ccb206acbd98fa6d9733de5deeeb0412c9e97c724b17a86891c34a'],
  ['ConceptRampMotorSpeed.java', '87fedd4508ebd669f8fe4d3a4bdb66fe13a9c01af2fb65c1ef1804f94070db02'],
  ['ConceptRevLED.java', 'f3f5f5ae25ab02217f239fdbddfa40862d37f7e08fb4d0f7d54dec7ffcd6c913'],
  ['ConceptRevSPARKMini.java', 'c946f3ed2acd7f6e343f2783f2cc7eebbd956c244c5c0ba675e16567ffe914c6'],
  ['ConceptScanServo.java', '9702fe6d734042ab00eb78e7cb758e515d05abffd4e1696e234e64da1481851b'],
  ['ConceptSoundsASJava.java', '8cc147b7a88aeb45a01e42a29def0857396131f136a60cc53ef77a9f68ea251f'],
  ['ConceptSoundsOnBotJava.java', '2b207cae5ff8349d7b9a1a97e4794d89dff2d369c16d64582e4dde3af453ec66'],
  ['ConceptSoundsSKYSTONE.java', 'ace67aab944fe9ed8bd62eb086976c660a78600f92593ea9d4ce6c6c689230ae'],
  ['ConceptTelemetry.java', 'dd611d2b14ade48fb247a717bab3fde19764837230113497e3e878fd0445dc21'],
  [
    'ConceptVisionColorLocator_Circle.java',
    'fa8d3c87236c82c8fc837eaafcd0bb3d38a51aa00af1ec857942b357ebe14e0b'
  ],
  [
    'ConceptVisionColorLocator_Rectangle.java',
    '514acf29deb97e78697d84d20c4a9b9ecedf2f878de7aa1ac3d69f81d2c84150'
  ],
  ['ConceptVisionColorSensor.java', 'e9d2854a4b7263d749433aff3b7be4073edea7c14b9519fcb148113dfdceacb2'],
  [
    'RobotAutoDriveByEncoder_Linear.java',
    '4ea82bddca941d7ae46568ed8da8e5bfcbca6c2f642ecba4891960cea3493d4e'
  ],
  ['RobotAutoDriveByGyro_Linear.java', '6ef4f21e5df67ea12d079fbe2489f4a031e5b8776352dd876d5b7de5c136b7a8'],
  ['RobotAutoDriveByTime_Linear.java', '0fdd7f8dbfabd5d69dbfd4c4bc17a1f309b51d647d74a37fbd87af3aeb19bc43'],
  [
    'RobotAutoDriveToAprilTagOmni.java',
    '1131bb676577581762c61b881d2ad357be28ae1e0af4cbe860b5d46feb0c7978'
  ],
  [
    'RobotAutoDriveToAprilTagTank.java',
    'fd09c189416579fc5e85d7ccbc0383d2834326fd555973bf353b3f195bdf4ab6'
  ],
  ['RobotAutoDriveToLine_Linear.java', 'ee2ac7ca251100ebc459c82872dfb5a228ef29bfb4eff295ac905a4c92128090'],
  [
    'RobotTeleopMecanumFieldRelativeDrive.java',
    '98c3e94dc45cba3dce84755970dc073614fa564b020bd31b49c8d1e45202dd96'
  ],
  ['RobotTeleopPOV_Linear.java', 'c3d9d269ce6e1c77c65125885a87a57b57a3946c3f0836a6cebbc2b9a2e67b7a'],
  ['RobotTeleopTank_Iterative.java', '9c02eb4f81c80751856c11afe30310a38d9ac9ac4153321311321b4a80616da5'],
  ['SampleRevBlinkinLedDriver.java', 'de56fe9355b0103d099c39b6ba601e9953a0897d0d6fc7bd429278c905541784'],
  [
    'SensorAndyMarkIMUNonOrthogonal.java',
    'a9808c9e5e21d24c9233f8616a74ae00ab2ee7f336faa7288aff8f5e5c5e68ec'
  ],
  ['SensorAndyMarkIMUOrthogonal.java', 'ae08ea83e98419a05ec8ca669c7190be272c9ce2f5eba43056e15be8ffda82e3'],
  ['SensorAndyMarkTOF.java', '0ca467f2b850d4cf6e510ec9941d4e47ad317a138c089d8b30ca263fa7511d4c'],
  ['SensorBNO055IMU.java', '1ad55824f04da682c629d7cdf08f0b72be63614443efdf086a3b0330ef627110'],
  ['SensorBNO055IMUCalibration.java', '179a23e6cdc6beb0774eac0186e4b8ca98044018804b0e18890fe4ad3b42c683'],
  ['SensorColor.java', '9109128bc860c981845648965d5ae861d1e1ce36cddc4c7d52026f2ed5dd4a78'],
  ['SensorDigitalTouch.java', '61ffcff5d7797276a751b27f70fbbff8f6ea0aab8268eab34f42b673c5985feb'],
  ['SensorGoBildaPinpoint.java', '23f193e089952415da968c55f053077532b16ebf909fe795af673382f2700da1'],
  ['SensorHuskyLens.java', '88ed2dd4e988a20dabe07f33a6352290c912c87fff753083b99bfa9cc03e596a'],
  ['SensorIMUNonOrthogonal.java', 'd568366fa4b64f0b4e4e1ef306e51ae60f38c9d55498feb3eae97f1d7aa59ad1'],
  ['SensorIMUOrthogonal.java', '2a1fd590eaa833e43775110b5c8dc38308a0f24afa1584798f4d7be6ab014409'],
  ['SensorKLNavxMicro.java', '2f5a31b7dc5736608c0a7409d11e009a4caf61e3f4a51e6fca0aa709f02ef420'],
  ['SensorLimelight3A.java', 'd06f754fb7501ae240e184d6a4efea1b1fab950711db38b8bd10364922734adc'],
  ['SensorMRColor.java', '42f11a5b5fd5fcd462bf8df27b0273dfc0c8efe6e8ce25908164fb21f83431e9'],
  ['SensorMRGyro.java', '2fd8dbe60420dec9f28f4c38da72f26521ded87a418613c3537bde3160ea787c'],
  ['SensorMROpticalDistance.java', '501581c8497258b0a8f95511b555640dea7751bf83d7d6e51f97ca217f0e234c'],
  ['SensorMRRangeSensor.java', 'd5a214ec476cd33448af4a81352b1dbbfdde91c3e806fcc0f1d5b0e1088c4dc8'],
  ['SensorOctoQuad.java', 'c81864290ed2c677ccdf40089a684ef4c6a1439f5f5c4942d1b8c3fd42c0bfba'],
  ['SensorOctoQuadAdv.java', '7a038feb8d06ca0a50902c610324e47057db4c9a9f365a073326f06d040c7601'],
  ['SensorOctoQuadLocalization.java', '03acd50e2249b1997914752af6936d9e7ed9ea8c758e1dd653df1216d7e7a620'],
  ['SensorREV2mDistance.java', 'de56bca0d478653a63922c2222f347a0ac480b5c2d119f158cb5ecc1a2901544'],
  ['SensorSparkFunOTOS.java', 'de3cd3c6932fa4982bb5c4e7d3e9bf1c3e64669789836bef39a834ba27cedebc'],
  ['SensorTouch.java', '918829fede18c6481318ce1af7a38685bee4ed8ad18399f9c484edcb60fdf1f7'],
  ['UtilityCameraFrameCapture.java', '50a2e17c844c66d0b9caed43ee0d913abdc7ff61ec3a53b5f119612145286907'],
  ['UtilityOctoQuadConfigMenu.java', '193ec93b39bfd59dff030d7c18054a8e32a009a8d8c6e3ec41f0ec968039bc75'],
  [
    'externalhardware/ConceptExternalHardwareClass.java',
    '5e6460de3e111aa2bddd31dbc3bcfc45d4fe7d26bfccc35bae420a7d6d09f6d3'
  ],
  [
    'externalhardware/RobotHardware.java',
    '587ba00ba3d91444c5539772565f8c18a149ef0e368e08df0955d11a48d47313'
  ]
]

// 받지 못한 이유(네트워크·해시). build-sidecar.mjs의 --optional이 경고로 바꾼다.
export class FetchError extends Error {}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function fileHash(path) {
  try {
    return sha256(readFileSync(path))
  } catch {
    return null
  }
}

// 옆에 임시 파일로 쓰고 바꾼다(받다 끊겨도 반쯤 쓴 파일이 남지 않게)
function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, bytes)
  renameSync(temp, path)
}

async function download(url, expectedSha256, log) {
  const attempts = 6
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryAfter = 0
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'sandbot-fetch-ftc-sdk' } })
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer())
        const actual = sha256(bytes)
        if (actual !== expectedSha256) {
          throw new FetchError(`${url}: SHA-256 ${actual} does not match ${expectedSha256}`)
        }
        return bytes
      }
      if (response.status !== 429 && response.status < 500) {
        throw new FetchError(`download failed: ${response.status} ${url}`)
      }
      retryAfter = Number(response.headers.get('retry-after')) * 1000 || 0
      lastError = new FetchError(`download failed: ${response.status} ${url}`)
    } catch (error) {
      if (error instanceof FetchError && !/download failed: (429|5\d\d)/.test(error.message)) throw error
      lastError =
        error instanceof FetchError
          ? error
          : new FetchError(
              `cannot download ${url} (${error.cause?.code ?? error.message}). ` +
                'Behind a proxy, set NODE_USE_ENV_PROXY=1'
            )
    }
    if (attempt < attempts) {
      const wait = Math.min(60000, Math.max(retryAfter, 1000 * 2 ** (attempt - 1)))
      log(`  ${lastError.message}; retrying in ${Math.round(wait / 1000)} s`)
      await sleep(wait)
    }
  }
  throw lastError
}

// ---- ZIP(AAR·jar) 읽기. Node에 내장 zip이 없어 중앙 디렉터리만 읽는 작은 구현(저장·deflate, ZIP64 아님).

export function readZip(bytes) {
  const minEnd = Math.max(0, bytes.length - 65557)
  let end = -1
  for (let i = bytes.length - 22; i >= minEnd; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a ZIP file')
  const count = bytes.readUInt16LE(end + 10)
  let offset = bytes.readUInt32LE(end + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad ZIP central directory')
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const size = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const local = bytes.readUInt32LE(offset + 42)
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, { method, compressedSize, size, local })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return {
    names: () => [...entries.keys()],
    read(name) {
      const entry = entries.get(name)
      if (!entry) return null
      if (bytes.readUInt32LE(entry.local) !== 0x04034b50) throw new Error(`bad ZIP entry ${name}`)
      const start =
        entry.local + 30 + bytes.readUInt16LE(entry.local + 26) + bytes.readUInt16LE(entry.local + 28)
      const data = bytes.subarray(start, start + entry.compressedSize)
      let out
      if (entry.method === 0) out = Buffer.from(data)
      else if (entry.method === 8) out = inflateRawSync(data)
      else throw new Error(`unsupported ZIP compression ${entry.method} for ${name}`)
      if (out.length !== entry.size) throw new Error(`ZIP entry ${name} has the wrong size`)
      return out
    }
  }
}

// ---- SDK

/**
 * SDK jar들을 받아 둔다(있고 맞으면 그대로).
 * @returns {Promise<{ version: string, jars: string[], libs: string[], androidJar: string }>}
 */
export async function ensureFtcSdk({ log = console.log } = {}) {
  const versionDir = join(ftcSdkDir, SDK_VERSION)
  const jars = []
  const libs = []
  for (const [name, hash] of AARS) {
    const aar = join(versionDir, 'aar', `${name}-${SDK_VERSION}.aar`)
    const jar = join(versionDir, `${name}.jar`)
    const stamp = join(versionDir, `${name}.extracted`)
    let bytes = null
    if (fileHash(aar) !== hash) {
      log(`downloading ${name}-${SDK_VERSION}.aar`)
      const url = `${MAVEN}/org/firstinspires/ftc/${name}/${SDK_VERSION}/${name}-${SDK_VERSION}.aar`
      bytes = await download(url, hash, log)
      writeAtomic(aar, bytes)
    }
    // classes.jar(와 libs/*.jar)는 이 AAR에서 꺼낸 것일 때만 쓴다
    let extracted = null
    try {
      extracted = JSON.parse(readFileSync(stamp, 'utf8'))
    } catch {
      // 다시 꺼낸다
    }
    const valid =
      extracted?.aar === hash &&
      fileHash(jar) === extracted.jar &&
      (extracted.libs ?? []).every(([lib, h]) => fileHash(join(versionDir, 'libs', lib)) === h)
    if (!valid) {
      const zip = readZip(bytes ?? readFileSync(aar))
      const classes = zip.read('classes.jar')
      if (!classes) throw new FetchError(`${name}-${SDK_VERSION}.aar has no classes.jar`)
      writeAtomic(jar, classes)
      const libHashes = []
      for (const entry of zip.names().filter((n) => /^libs\/[^/]+\.jar$/.test(n))) {
        const lib = entry.slice('libs/'.length)
        const libBytes = zip.read(entry)
        writeAtomic(join(versionDir, 'libs', lib), libBytes)
        libHashes.push([lib, sha256(libBytes)])
      }
      extracted = { aar: hash, jar: sha256(classes), libs: libHashes }
      writeAtomic(stamp, `${JSON.stringify(extracted, null, 2)}\n`)
    }
    jars.push(jar)
    for (const [lib] of extracted.libs) libs.push(join(versionDir, 'libs', lib))
  }
  const androidJar = join(ftcSdkDir, ANDROID_JAR.file)
  if (fileHash(androidJar) !== ANDROID_JAR.sha256) {
    log(`downloading ${ANDROID_JAR.file}`)
    writeAtomic(androidJar, await download(ANDROID_JAR.url, ANDROID_JAR.sha256, log))
  }
  return { version: SDK_VERSION, jars, libs, androidJar }
}

// ---- 샘플

/**
 * FtcRobotController v12.0 샘플을 받아 둔다(파일마다 해시 확인, 빠진 것·다른 것만 받는다).
 * @returns {Promise<{ dir: string, files: string[] }>}
 */
export async function ensureFtcSamples({ log = console.log } = {}) {
  const files = []
  for (const [path, hash] of SAMPLES) {
    const target = join(samplesDir, ...path.split('/'))
    if (fileHash(target) !== hash) {
      const url = `https://raw.githubusercontent.com/FIRST-Tech-Challenge/FtcRobotController/${SAMPLES_COMMIT}/${SAMPLES_PATH}/${path}`
      log(`downloading sample ${path}`)
      writeAtomic(target, await download(url, hash, log))
    }
    files.push(target)
  }
  return { dir: samplesDir, files }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sdk = await ensureFtcSdk()
    console.log(`FTC SDK ${sdk.version}: ${dirname(sdk.jars[0])}`)
    if (!process.argv.includes('--no-samples')) {
      const samples = await ensureFtcSamples()
      console.log(`FtcRobotController samples (${samples.files.length}): ${samples.dir}`)
    }
  } catch (error) {
    if (!(error instanceof FetchError)) throw error
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  }
}
