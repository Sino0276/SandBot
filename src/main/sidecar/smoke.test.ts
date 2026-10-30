import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIN_JDK_MAJOR, type JdkInfo, type PlayEvent } from '../../shared/play'
import { detectJdks, javaTool, nodeJdkFs } from '../jdk'
import { clearOpModeCache, scanOpModes } from '../opModes'
import { clearTrustedRoots, trustRoot } from '../projectRoots'
import { RegisteredOpModes } from '../registeredOpModes'
import { PlayController, type ControllerDeps } from './controller'
import { simFirstFolder } from './launch'
import { spawnSidecar, type SpawnSidecar } from './process'

// 진짜 사이드카(JVM) 연기 테스트. sidecar/tests/support.ts(툴체인)가 지금 소스로 빌드한 사이드카를 주고, JDK가 없으면
// null을 준다(그러면 건너뛴다). support.ts가 아직 없는 브랜치에서도 이 파일은 통과해야 하므로 경로로 불러온다.

type SidecarBuild = {
  jdkHome: string
  java: string
  javac: string
  sdkJar: string
  runtimeJar: string
  dir: string
}

const SUPPORT = join(process.cwd(), 'sidecar', 'tests', 'support.ts')

const SMOKE = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

@TeleOp(name = "Smoke")
public class Smoke extends LinearOpMode {
    @Override
    public void runOpMode() {
        telemetry.addData("hello", "world");
        telemetry.update();
        System.out.println("waiting");
        waitForStart();
        sleep(100);
        telemetry.addData("done", true);
        telemetry.update();
    }
}
`

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe.skipIf(!existsSync(SUPPORT))('진짜 사이드카', () => {
  let build: SidecarBuild | null = null
  let dir: string

  beforeAll(async () => {
    const support = (await import(/* @vite-ignore */ SUPPORT)) as {
      sidecarBuild: () => Promise<SidecarBuild | null>
    }
    build = await support.sidecarBuild()
    dir = await mkdtemp(join(tmpdir(), 'sandbot-smoke-'))
  }, 600_000)

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('LinearOpMode가 텔레메트리를 보내고 START 뒤 스스로 끝난다', async (context) => {
    if (!build) {
      context.skip()
      return
    }
    const sidecar = build
    const root = join(dir, 'project')
    const file = join(root, 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/Smoke.java')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, SMOKE)
    clearTrustedRoots()
    trustRoot(root)

    const events: PlayEvent[] = []
    const controller = new PlayController({
      resolveJdk: async () => ({ home: sidecar.jdkHome, version: '', major: 21, source: 'path' }),
      locateSidecar: async () => ({
        dir: sidecar.dir,
        runtimeJar: sidecar.runtimeJar,
        sdkJar: sidecar.sdkJar,
        dashboardJar: null
      }),
      spawn: spawnSidecar,
      makeRunDir: () => mkdtemp(join(dir, 'run-')),
      removeRunDir: (path) => rm(path, { recursive: true, force: true }),
      platform: process.platform,
      env: process.env
    })
    const owner = { send: (event: PlayEvent): void => void events.push(event) }
    const result = await controller.init(
      {
        runId: 'smoke',
        root,
        opMode: {
          className: 'org.firstinspires.ftc.teamcode.Smoke',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/Smoke.java',
          flavor: 'TeleOp'
        },
        configPath: null,
        settings: {
          speed: 'max',
          jitter: 0,
          seed: 0,
          autoStopAutonomous: true,
          batteryVoltage: 12.5
        },
        world: null
      },
      owner
    )
    expect(result).toEqual({ ok: true })
    const phases = (): string[] =>
      events.flatMap((event) => (event.type === 'phase' ? [event.phase] : []))
    const finished = (): Extract<PlayEvent, { type: 'finished' }> | undefined =>
      events.find(
        (event): event is Extract<PlayEvent, { type: 'finished' }> => event.type === 'finished'
      )
    try {
      await waitFor(() => phases().includes('init') || finished() !== undefined, 120_000)
      expect(finished(), JSON.stringify(events.slice(-5))).toBeUndefined()
      controller.command({ type: 'start' }, owner)
      await waitFor(() => finished() !== undefined, 60_000)
    } finally {
      await controller.disposeAll()
    }
    expect(finished()).toMatchObject({ reason: 'returned' })
    expect(events.find((event) => event.type === 'compiled')).toMatchObject({ ok: true })
    const lines = events.flatMap((event) => (event.type === 'telemetry' ? event.frame.lines : []))
    // 최대 속도라 텔레메트리는 최신 것만 넘어온다(34 ms 묶음). 끝날 때 마지막 화면은 반드시 보낸다.
    expect(lines.some((line) => line.includes('done') && line.includes('true'))).toBe(true)
    const logs = events.flatMap((event) => (event.type === 'log' ? event.entries : []))
    expect(logs.some((entry) => entry.stream === 'out' && entry.text.includes('waiting'))).toBe(
      true
    )
    expect(events.every((event) => event.runId === 'smoke')).toBe(true)
  }, 600_000)

  it('등록기 OpMode: 목록(JVM 한 번, 같은 입력이면 캐시)과 이름으로 실행(등록한 인스턴스, 모의 저장소)', async (context) => {
    if (!build) {
      context.skip()
      return
    }
    const sidecar = build
    const root = join(dir, 'registrar-project')
    const pkg = join(root, 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode')
    await mkdir(pkg, { recursive: true })
    await writeFile(join(pkg, 'Tuning.java'), TUNING)
    await writeFile(join(pkg, 'Smoke.java'), SMOKE)
    clearTrustedRoots()
    clearOpModeCache()
    trustRoot(root)
    let spawns = 0
    const spawn: SpawnSidecar = (command, args, options) => {
      spawns++
      return spawnSidecar(command, args, options)
    }
    const simRoot = join(dir, 'sim-files')
    const deps: ControllerDeps = {
      resolveJdk: async () => ({ home: sidecar.jdkHome, version: '', major: 21, source: 'path' }),
      locateSidecar: async () => ({
        dir: sidecar.dir,
        runtimeJar: sidecar.runtimeJar,
        sdkJar: sidecar.sdkJar,
        dashboardJar: null
      }),
      spawn,
      makeRunDir: () => mkdtemp(join(dir, 'run-')),
      removeRunDir: (path) => rm(path, { recursive: true, force: true }),
      platform: process.platform,
      env: process.env,
      makeFirstFolder: (projectRoot) => simFirstFolder(simRoot, projectRoot)
    }
    const lister = new RegisteredOpModes({
      ...deps,
      scan: scanOpModes,
      makeFirstFolder: (projectRoot) => simFirstFolder(simRoot, projectRoot)
    })
    const listed = await lister.list(root)
    expect(listed).toEqual({
      ok: true,
      replaced: ['org.firstinspires.ftc.teamcode.Smoke'],
      diagnostics: [],
      errors: [],
      opModes: [
        {
          className: 'org.firstinspires.ftc.teamcode.Smoke',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/Tuning.java',
          line: 24,
          flavor: 'TeleOp',
          name: 'Smoke (registered)',
          group: '',
          preselectTeleOp: '',
          registered: { registrar: 'org.firstinspires.ftc.teamcode.Tuning' }
        },
        {
          className: 'org.firstinspires.ftc.teamcode.Tuning$Tuner',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/Tuning.java',
          line: 24,
          flavor: 'TeleOp',
          name: 'Tuner-forward',
          group: 'tuning',
          preselectTeleOp: '',
          registered: { registrar: 'org.firstinspires.ftc.teamcode.Tuning' }
        }
      ]
    })
    expect(await lister.list(root)).toBe(listed)
    expect(spawns).toBe(1)

    const events: PlayEvent[] = []
    const controller = new PlayController({
      ...deps,
      registrars: (projectRoot) => lister.registrarsFor(projectRoot)
    })
    const owner = { send: (event: PlayEvent): void => void events.push(event) }
    const result = await controller.init(
      {
        runId: 'registered',
        root,
        opMode: {
          className: 'org.firstinspires.ftc.teamcode.Tuning',
          path: 'src/main/java/org/firstinspires/ftc/teamcode/Tuning.java',
          flavor: 'TeleOp',
          registeredName: 'Tuner-forward'
        },
        configPath: null,
        settings: {
          speed: 'max',
          jitter: 0,
          seed: 0,
          autoStopAutonomous: true,
          batteryVoltage: 12.5
        },
        world: null
      },
      owner
    )
    expect(result).toEqual({ ok: true })
    const finished = (): Extract<PlayEvent, { type: 'finished' }> | undefined =>
      events.find(
        (event): event is Extract<PlayEvent, { type: 'finished' }> => event.type === 'finished'
      )
    try {
      await waitFor(() => finished() !== undefined, 120_000)
    } finally {
      await controller.disposeAll()
    }
    expect(finished()).toMatchObject({ reason: 'returned' })
    const out = events.flatMap((event) =>
      event.type === 'log' ? event.entries.filter((e) => e.stream === 'out').map((e) => e.text) : []
    )
    expect(out).toEqual([`tuner forward ${await simFirstFolder(simRoot, root)}`])
  }, 600_000)
})

const TUNING = `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

public final class Tuning {
    public static class Tuner extends LinearOpMode {
        private final String direction;

        public Tuner(String direction) {
            this.direction = direction;
        }

        @Override
        public void runOpMode() {
            System.out.println("tuner " + direction + " " + AppUtil.ROOT_FOLDER);
        }
    }

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        String direction = "forward";
        manager.register(new OpModeMeta.Builder().setName("Tuner-" + direction).setGroup("tuning").build(),
                new Tuner(direction));
        manager.register(new OpModeMeta.Builder().setName("Hidden").setFlavor(OpModeMeta.Flavor.UTILITY).build(),
                new Tuner("utility"));
        // annotated OpMode를 다른 이름의 클래스로: 실제 SDK처럼 등록기의 이름으로만 보인다
        manager.register("Smoke (registered)", Smoke.class);
    }
}
`

// 사이드카 빌드 없이 이 PC의 JDK로 진짜 JVM을 띄운다: 프로토콜의 사이드카 쪽을 아주 작게 흉내 내는 Main을 컴파일해
// 런타임 jar 자리(클래스 폴더)에 둔다. JVM 인자(-D…encoding 등)가 받아들여지는지, 한글이 UTF-8로 오가는지,
// stderr의 JVM 안내 줄(Picked up JAVA_TOOL_OPTIONS)이 crashed detail에서 빠지는지 본다.
const STUB_MAIN = `package org.sandbot.runtime;

import java.io.*;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        out.println("{\\"type\\":\\"hello\\",\\"protocol\\":3,\\"runtime\\":\\"stub\\",\\"java\\":\\"" + System.getProperty("java.version") + "\\"}");
        String run = in.readLine();
        boolean crash = run.contains("Crash");
        out.println("{\\"type\\":\\"compiled\\",\\"ok\\":true,\\"diagnostics\\":[],\\"millis\\":1}");
        out.println("{\\"type\\":\\"state\\",\\"tNanos\\":0,\\"phase\\":\\"init\\"}");
        out.println("{\\"type\\":\\"log\\",\\"tNanos\\":0,\\"stream\\":\\"out\\",\\"text\\":\\"안녕 SandBot \\u00b0\\"}");
        out.println("{\\"type\\":\\"tick\\",\\"tick\\":0,\\"tNanos\\":0,\\"phase\\":\\"init\\",\\"loops\\":0,\\"outputs\\":{}}");
        String reply = in.readLine();
        if (crash) {
            System.err.println("치명적 오류: " + reply.length());
            System.exit(3);
        }
        out.println("{\\"type\\":\\"finished\\",\\"tNanos\\":0,\\"reason\\":\\"returned\\"}");
        out.flush();
        Runtime.getRuntime().halt(0);
    }
}
`

describe('진짜 JVM(작은 프로토콜 흉내)', () => {
  let jdk: JdkInfo | null = null
  let dir: string
  let classes: string

  beforeAll(async () => {
    const found = await detectJdks({
      platform: process.platform,
      env: process.env,
      home: homedir(),
      fs: nodeJdkFs,
      queryRegistry: async () => ''
    })
    jdk = found.find((info) => info.major >= MIN_JDK_MAJOR) ?? null
    dir = await mkdtemp(join(tmpdir(), 'sandbot-stub-jvm-'))
    if (!jdk) return
    const source = join(dir, 'src', 'org', 'sandbot', 'runtime', 'Main.java')
    await mkdir(dirname(source), { recursive: true })
    await writeFile(source, STUB_MAIN)
    classes = join(dir, 'classes')
    await promisify(execFile)(javaTool(jdk.home, 'javac', process.platform), [
      '-encoding',
      'UTF-8',
      '-d',
      classes,
      source
    ])
  }, 120_000)

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  const run = async (
    name: string,
    javaToolOptions = '-Dsandbot.test=1'
  ): Promise<{ events: PlayEvent[]; finished: Extract<PlayEvent, { type: 'finished' }> }> => {
    const root = join(dir, 'project')
    const file = join(root, `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/${name}.java`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `@TeleOp public class ${name} {}\n`)
    clearTrustedRoots()
    trustRoot(root)
    const events: PlayEvent[] = []
    const deps: ControllerDeps = {
      resolveJdk: async () => jdk,
      locateSidecar: async () => ({
        dir: classes,
        runtimeJar: classes,
        sdkJar: classes,
        dashboardJar: null
      }),
      spawn: spawnSidecar,
      makeRunDir: () => mkdtemp(join(dir, 'run-')),
      removeRunDir: (path) => rm(path, { recursive: true, force: true }),
      platform: process.platform,
      env: { ...process.env, JAVA_TOOL_OPTIONS: javaToolOptions }
    }
    const controller = new PlayController(deps)
    const owner = { send: (event: PlayEvent): void => void events.push(event) }
    const result = await controller.init(
      {
        runId: `stub-${name}`,
        root,
        opMode: {
          className: `org.firstinspires.ftc.teamcode.${name}`,
          path: `src/main/java/org/firstinspires/ftc/teamcode/${name}.java`,
          flavor: 'TeleOp'
        },
        configPath: null,
        settings: {
          speed: 'max',
          jitter: 0,
          seed: 0,
          autoStopAutonomous: true,
          batteryVoltage: 12.5
        },
        world: null
      },
      owner
    )
    expect(result).toEqual({ ok: true })
    const finished = (): Extract<PlayEvent, { type: 'finished' }> | undefined =>
      events.find(
        (event): event is Extract<PlayEvent, { type: 'finished' }> => event.type === 'finished'
      )
    await waitFor(() => finished() !== undefined, 60_000)
    await controller.disposeAll()
    return { events, finished: finished()! }
  }

  it('JVM 인자를 받아들이고, 한글 로그가 UTF-8로 온다', async (context) => {
    if (!jdk) {
      context.skip()
      return
    }
    const { events, finished } = await run('Hello')
    expect(finished).toMatchObject({ reason: 'returned' })
    const texts = events.flatMap((event) =>
      event.type === 'log' ? event.entries.map((entry) => entry.text) : []
    )
    expect(texts).toContain('안녕 SandBot °')
  }, 120_000)

  // 통합 로깅(-Xlog)의 기본 출력은 stdout이다. 큰 페이지가 없는 Linux에서 UseLargePages는 경고 줄을 쓰는데, 그 줄이
  // 프로토콜 줄 사이에 섞이면 실행이 crashed로 끝난다(스레드를 더 만들지 못함·코드 캐시 가득 참 같은 실행 중 경고도 같다).
  it('JVM 경고는 stdout(프로토콜)에 섞이지 않는다', async (context) => {
    if (!jdk) {
      context.skip()
      return
    }
    const { finished } = await run('Warns', '-XX:+UseLargePages')
    expect(finished).toMatchObject({ reason: 'returned' })
  }, 120_000)

  it('finished 없이 끝나면 crashed이고 detail은 stderr(한글 포함, JVM 안내 줄 제외)', async (context) => {
    if (!jdk) {
      context.skip()
      return
    }
    const { finished } = await run('Crash')
    expect(finished.reason).toBe('crashed')
    expect(finished.detail).toMatch(/^exit code 3\n치명적 오류: \d+$/)
  }, 120_000)
})
