import type { ChildProcess, SpawnOptions } from 'child_process'
import { EventEmitter } from 'events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedEditor } from '../shared/ipc'
import {
  buildEditorCommand,
  DEFAULT_CUSTOM_ARGS,
  detectEditors,
  editorEnv,
  isLaunchableExePath,
  launchEditorProcess,
  openInExternalEditor,
  parseArgsTemplate,
  parseStoredEditor,
  parseUninstallEntries,
  presetArgs,
  readEditorSettings,
  registryCandidates,
  resetDetectedEditors,
  setEditor,
  wellKnownCandidates,
  writeEditorSettings,
  type EditorDeps,
  type SpawnFn
} from './externalEditor'

const STUDIO = 'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe'
const CODE = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
const PROJECT = 'C:\\Users\\me\\My Robot\\FtcRobotController'
const FILE = `${PROJECT}\\TeamCode\\src\\main\\java\\org\\firstinspires\\ftc\\teamcode\\Lift.java`

const command = (exe: string, args: string, line?: number): ReturnType<typeof buildEditorCommand> =>
  buildEditorCommand({ exe, args }, { file: FILE, line, projectPath: PROJECT }, 'win32')

describe('buildEditorCommand', () => {
  it('JetBrains(Android Studio·IntelliJ)는 프로젝트, --line, 파일 순이다', () => {
    expect(command(STUDIO, presetArgs('jetbrains', true), 42)).toEqual({
      ok: true,
      exe: STUDIO,
      argv: [PROJECT, '--line', '42', FILE]
    })
    // 줄이 없으면 --line을 뺀다
    expect(command(STUDIO, presetArgs('jetbrains', false))).toEqual({
      ok: true,
      exe: STUDIO,
      argv: [PROJECT, FILE]
    })
  })

  it('VS Code는 프로젝트와 -g 파일:줄이다', () => {
    expect(command(CODE, presetArgs('vscode', true), 7)).toEqual({
      ok: true,
      exe: CODE,
      argv: [PROJECT, '-g', `${FILE}:7`]
    })
    expect(command(CODE, presetArgs('vscode', false))).toEqual({
      ok: true,
      exe: CODE,
      argv: [PROJECT, FILE]
    })
  })

  it('직접 고른 편집기의 기본 인자는 파일 하나다', () => {
    expect(command('C:\\Tools\\Notepad++\\notepad++.exe', DEFAULT_CUSTOM_ARGS, 3)).toEqual({
      ok: true,
      exe: 'C:\\Tools\\Notepad++\\notepad++.exe',
      argv: [FILE]
    })
  })

  it('따옴표와 공백이 있는 템플릿을 셸 없이 나누고, 값은 인자 안에서 바꾼다', () => {
    const result = buildEditorCommand(
      {
        exe: 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
        args: '  --project "$(ProjectPath)\\robot.sublime-project"\t-n "$(File):$(Line):$(Column)" ""'
      },
      { file: 'C:\\a b\\it\'s "q" $& $1.java', line: 5, column: 9, projectPath: 'C:\\my proj' },
      'win32'
    )
    expect(result).toEqual({
      ok: true,
      exe: 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
      argv: [
        '--project',
        'C:\\my proj\\robot.sublime-project',
        '-n',
        'C:\\a b\\it\'s "q" $& $1.java:5:9',
        ''
      ]
    })
    // 줄·열이 없으면 1이다
    expect(command(STUDIO, '$(File) $(Line) $(Column)')).toMatchObject({
      argv: [FILE, '1', '1']
    })
  })

  it('$(File)이 없거나, 따옴표가 닫히지 않았거나, 줄바꿈·NUL이 있거나, 너무 길면 실행하지 않는다', () => {
    expect(command(STUDIO, '--line $(Line)')).toEqual({ ok: false, error: 'noFile' })
    expect(command(STUDIO, '"$(File)')).toEqual({ ok: false, error: 'unclosedQuote' })
    expect(command(STUDIO, '"$(File)"\n--evil')).toEqual({ ok: false, error: 'invalidChar' })
    expect(command(STUDIO, '"$(File)"\r')).toEqual({ ok: false, error: 'invalidChar' })
    expect(command(STUDIO, '"$(File)"\0')).toEqual({ ok: false, error: 'invalidChar' })
    expect(command(STUDIO, `"$(File)" ${'x'.repeat(1000)}`)).toEqual({
      ok: false,
      error: 'tooLong'
    })
    // 변수 이름은 대소문자를 구분한다
    expect(command(STUDIO, '$(file)')).toEqual({ ok: false, error: 'noFile' })
  })

  it('Windows에서 .exe가 아닌 실행 파일(.bat·.cmd·.lnk·.ps1 등)과 상대 경로는 실행하지 않는다', () => {
    for (const exe of [
      'C:\\Android Studio\\bin\\studio.bat',
      'C:\\VS Code\\bin\\code.cmd',
      'C:\\Users\\me\\Desktop\\Android Studio.lnk',
      'C:\\Tools\\open.ps1',
      'C:\\Tools\\open.vbs',
      'C:\\Tools\\studio64.exe.',
      'C:\\Tools\\studio64.exe:stream',
      'studio64.exe',
      'bin\\studio64.exe',
      'C:studio64.exe'
    ]) {
      expect(command(exe, DEFAULT_CUSTOM_ARGS), exe).toEqual({
        ok: false,
        error: 'unsupportedExe'
      })
    }
    expect(isLaunchableExePath('C:\\Tools\\STUDIO64.EXE', 'win32')).toBe(true)
  })

  it('다른 OS는 절대 경로의 실행 파일이면 스크립트도 받지만 Windows 스크립트는 받지 않는다', () => {
    expect(isLaunchableExePath('/opt/android-studio/bin/studio.sh', 'linux')).toBe(true)
    expect(isLaunchableExePath('/usr/bin/code', 'linux')).toBe(true)
    expect(isLaunchableExePath('bin/studio.sh', 'linux')).toBe(false)
    for (const exe of ['/x/studio.bat', '/x/code.cmd', '/x/a.lnk', '/x/a.ps1']) {
      expect(isLaunchableExePath(exe, 'darwin'), exe).toBe(false)
    }
  })
})

describe('parseArgsTemplate', () => {
  it('따옴표로 묶은 부분과 붙은 부분을 한 인자로 잇는다', () => {
    expect(parseArgsTemplate('"$(ProjectPath)" -g "$(File)":$(Line)')).toEqual({
      ok: true,
      tokens: ['$(ProjectPath)', '-g', '$(File):$(Line)']
    })
    expect(parseArgsTemplate('a"b c"d $(File)')).toEqual({ ok: true, tokens: ['ab cd', '$(File)'] })
  })
})

describe('설정 파일', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-editor-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('깨졌거나 모르는 내용이면 확장자로 열기(system)다', () => {
    expect(parseStoredEditor('{')).toEqual({ kind: 'system' })
    expect(parseStoredEditor('null')).toEqual({ kind: 'system' })
    expect(parseStoredEditor('"custom"')).toEqual({ kind: 'system' })
    expect(parseStoredEditor('{"kind":"detected","id":"notepad","exe":"C:\\\\n.exe"}')).toEqual({
      kind: 'system'
    })
    expect(parseStoredEditor('{"kind":"custom","exe":"","args":"$(File)"}')).toEqual({
      kind: 'system'
    })
    expect(parseStoredEditor('{"kind":"custom","exe":"C:\\\\a.exe","args":7}')).toEqual({
      kind: 'system'
    })
    expect(
      parseStoredEditor(JSON.stringify({ kind: 'detected', id: 'vscode', exe: CODE }))
    ).toEqual({ kind: 'detected', id: 'vscode', exe: CODE })
  })

  it('임시 파일에 쓴 뒤 바꿔 끼우고, 파일이 없거나 깨졌으면 system으로 읽는다', async () => {
    const file = join(dir, 'external-editor.json')
    expect(await readEditorSettings(file)).toEqual({ kind: 'system' })
    const value = { kind: 'custom', exe: '/usr/bin/gedit', args: '+$(Line) "$(File)"' } as const
    await writeEditorSettings(file, value)
    expect(await readEditorSettings(file)).toEqual(value)
    expect(await readdir(dir)).toEqual(['external-editor.json'])
    await writeFile(file, '{"kind":"custom",')
    expect(await readEditorSettings(file)).toEqual({ kind: 'system' })
  })
})

// reg query <Uninstall> /s 출력(일부)
const REG_OUTPUT = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{771FD6B0-FA20-440A-A002-3B3BAC16DC50}_is1',
  '    Inno Setup: Setup Version    REG_SZ    6.2.2',
  '    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\',
  '    DisplayName    REG_SZ    Microsoft Visual Studio Code (User)',
  '    EstimatedSize    REG_DWORD    0x5a1e3',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{217B4C08}_is1',
  '    DisplayName    REG_SZ    Microsoft Visual Studio Code - Insiders (User)',
  '    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code Insiders\\',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Android Studio',
  '    DisplayName    REG_SZ    Android Studio',
  '    DisplayIcon    REG_SZ    "D:\\Android Studio\\bin\\studio64.exe",0',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\IntelliJ IDEA Community Edition 2024.1',
  '    DisplayName    REG_SZ    IntelliJ IDEA Community Edition 2024.1',
  '    InstallLocation    REG_EXPAND_SZ    %ProgramFiles%\\JetBrains\\IntelliJ IDEA Community Edition 2024.1',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip',
  '    DisplayName    REG_SZ    7-Zip 23.01 (x64)',
  '    InstallLocation    REG_SZ    C:\\Program Files\\7-Zip\\',
  ''
].join('\r\n')

describe('편집기 찾기', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files'
  }

  it('레지스트리 Uninstall 항목에서 Android Studio·IntelliJ·VS Code를 찾는다', () => {
    const entries = parseUninstallEntries(REG_OUTPUT, { PROGRAMFILES: 'C:\\Program Files' })
    expect(entries.map((entry) => entry.displayName)).toEqual([
      'Microsoft Visual Studio Code (User)',
      'Microsoft Visual Studio Code - Insiders (User)',
      'Android Studio',
      'IntelliJ IDEA Community Edition 2024.1',
      '7-Zip 23.01 (x64)'
    ])
    expect(registryCandidates(entries)).toEqual([
      { id: 'vscode', exe: CODE },
      { id: 'android-studio', exe: 'D:\\Android Studio\\bin\\studio64.exe' },
      {
        id: 'intellij-idea',
        exe: 'C:\\Program Files\\JetBrains\\IntelliJ IDEA Community Edition 2024.1\\bin\\idea64.exe'
      }
    ])
  })

  it('Windows 기본 위치(사용자 설치 → Program Files)', () => {
    expect(wellKnownCandidates('win32', env, 'C:\\Users\\me')).toEqual([
      {
        id: 'android-studio',
        exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\Android Studio\\bin\\studio64.exe'
      },
      { id: 'android-studio', exe: STUDIO },
      {
        id: 'intellij-idea',
        exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\IntelliJ IDEA Ultimate\\bin\\idea64.exe'
      },
      {
        id: 'intellij-idea',
        exe: 'C:\\Users\\me\\AppData\\Local\\Programs\\IntelliJ IDEA Community Edition\\bin\\idea64.exe'
      },
      { id: 'vscode', exe: CODE },
      { id: 'vscode', exe: 'C:\\Program Files\\Microsoft VS Code\\Code.exe' }
    ])
  })

  it('종류마다 처음 찾은 실행 파일 하나를 쓴다(레지스트리 → 기본 위치)', async () => {
    const existing = new Set([
      'D:\\Android Studio\\bin\\studio64.exe',
      STUDIO,
      'C:\\Program Files\\Microsoft VS Code\\Code.exe'
    ])
    const queried: string[] = []
    const detected = await detectEditors({
      platform: 'win32',
      env,
      home: 'C:\\Users\\me',
      isExecutable: async (path) => existing.has(path),
      queryRegistry: async (key) => {
        queried.push(key)
        return key.startsWith('HKLM\\SOFTWARE\\Microsoft') ? REG_OUTPUT : ''
      }
    })
    expect(queried).toHaveLength(3)
    expect(detected).toEqual([
      {
        id: 'android-studio',
        name: 'Android Studio',
        exe: 'D:\\Android Studio\\bin\\studio64.exe'
      },
      {
        id: 'vscode',
        name: 'Visual Studio Code',
        exe: 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
      }
    ])
  })

  it('Linux는 레지스트리 없이 기본 위치만 본다', async () => {
    const detected = await detectEditors({
      platform: 'linux',
      env: {},
      home: '/home/me',
      isExecutable: async (path) => path === '/home/me/android-studio/bin/studio.sh',
      queryRegistry: async () => {
        throw new Error('no registry on linux')
      }
    })
    expect(detected).toEqual([
      { id: 'android-studio', name: 'Android Studio', exe: '/home/me/android-studio/bin/studio.sh' }
    ])
  })
})

class FakeChild extends EventEmitter {
  unref = vi.fn()
}

function fakeSpawn(behaviour: 'spawn' | 'error' | 'throw'): {
  spawn: SpawnFn
  calls: { exe: string; argv: string[]; options: SpawnOptions; child: FakeChild }[]
} {
  const calls: { exe: string; argv: string[]; options: SpawnOptions; child: FakeChild }[] = []
  const spawn: SpawnFn = (exe, argv, options) => {
    if (behaviour === 'throw') throw new Error('spawn EINVAL')
    const child = new FakeChild()
    calls.push({ exe, argv, options, child })
    queueMicrotask(() => {
      if (behaviour === 'spawn') child.emit('spawn')
      else child.emit('error', new Error('spawn ENOENT'))
    })
    return child as unknown as ChildProcess
  }
  return { spawn, calls }
}

describe('launchEditorProcess', () => {
  it('셸 없이, 떼어 놓고, 창을 숨기지 않고, 위험한 환경 변수를 빼고 띄운다', async () => {
    const { spawn, calls } = fakeSpawn('spawn')
    const result = await launchEditorProcess({ exe: STUDIO, argv: ['a'] }, PROJECT, spawn, {
      PATH: 'x',
      ELECTRON_RUN_AS_NODE: '1',
      node_options: '--require evil'
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    const { options, child } = calls[0]
    expect(options).toEqual({
      shell: false,
      detached: true,
      stdio: 'ignore',
      cwd: PROJECT,
      env: { PATH: 'x' }
    })
    expect(options).not.toHaveProperty('windowsHide')
    expect(child.unref).toHaveBeenCalled()
    // 뜬 뒤에 오는 오류가 메인 프로세스를 죽이지 않는다
    expect(() => child.emit('error', new Error('late'))).not.toThrow()
  })

  it('실행하지 못하면 launchFailed와 이유를 돌려준다', async () => {
    expect(
      await launchEditorProcess({ exe: STUDIO, argv: [] }, PROJECT, fakeSpawn('error').spawn)
    ).toEqual({ ok: false, code: 'launchFailed', detail: 'spawn ENOENT' })
    expect(
      await launchEditorProcess({ exe: STUDIO, argv: [] }, PROJECT, fakeSpawn('throw').spawn)
    ).toEqual({ ok: false, code: 'launchFailed', detail: 'spawn EINVAL' })
  })

  it('편집기 환경 변수에서 ELECTRON_RUN_AS_NODE·NODE_OPTIONS만 뺀다(대소문자 무시)', () => {
    expect(
      editorEnv({ Path: 'p', Electron_Run_As_Node: '1', NODE_OPTIONS: 'x', ELECTRON_OTHER: 'y' })
    ).toEqual({ Path: 'p', ELECTRON_OTHER: 'y' })
  })
})

describe('openInExternalEditor·setEditor', () => {
  let dir: string
  let settingsFile: string
  let openPath: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>
  let detected: DetectedEditor[]
  let executables: Set<string>
  let spawned: ReturnType<typeof fakeSpawn>

  const deps = (): EditorDeps => ({
    settingsFile,
    platform: 'win32',
    spawn: spawned.spawn,
    openPath,
    isExecutable: async (path) => executables.has(path),
    detect: async () => detected
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-editor-'))
    settingsFile = join(dir, 'external-editor.json')
    openPath = vi.fn(async () => '')
    detected = [{ id: 'android-studio', name: 'Android Studio', exe: STUDIO }]
    executables = new Set([STUDIO])
    spawned = fakeSpawn('spawn')
    resetDetectedEditors()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('기본(system)은 .java만 운영체제에 맡기고, 실패 문구를 돌려준다', async () => {
    expect(await openInExternalEditor(FILE, PROJECT, 3, deps())).toEqual({ ok: true })
    expect(openPath).toHaveBeenCalledWith(FILE)
    openPath.mockResolvedValueOnce('No application is associated')
    expect(await openInExternalEditor(FILE, PROJECT, 3, deps())).toEqual({
      ok: false,
      code: 'openFailed',
      detail: 'No application is associated'
    })
    expect(await openInExternalEditor('C:\\x\\evil.exe', PROJECT, 3, deps())).toMatchObject({
      code: 'notAllowed'
    })
    expect(openPath).toHaveBeenCalledTimes(2)
    expect(spawned.calls).toEqual([])
  })

  it('찾은 편집기는 프리셋 인자로 띄운다', async () => {
    await setEditor({ kind: 'detected', id: 'android-studio' }, deps(), async () => null)
    expect(await openInExternalEditor(FILE, PROJECT, 9, deps())).toEqual({ ok: true })
    expect(spawned.calls.map(({ exe, argv }) => ({ exe, argv }))).toEqual([
      { exe: STUDIO, argv: [PROJECT, '--line', '9', FILE] }
    ])
    expect(openPath).not.toHaveBeenCalled()
  })

  it('저장한 실행 파일이 없어졌으면 같은 편집기를 다시 찾고, 없으면 launchFailed다', async () => {
    const moved = 'C:\\Users\\me\\AppData\\Local\\Programs\\Android Studio\\bin\\studio64.exe'
    await writeEditorSettings(settingsFile, { kind: 'detected', id: 'android-studio', exe: STUDIO })
    executables = new Set([moved])
    detected = [{ id: 'android-studio', name: 'Android Studio', exe: moved }]
    expect(await openInExternalEditor(FILE, PROJECT, undefined, deps())).toEqual({ ok: true })
    expect(spawned.calls[0]).toMatchObject({ exe: moved, argv: [PROJECT, FILE] })
    expect(await readEditorSettings(settingsFile)).toEqual({
      kind: 'detected',
      id: 'android-studio',
      exe: moved
    })

    executables = new Set()
    detected = []
    expect(await openInExternalEditor(FILE, PROJECT, 1, deps())).toMatchObject({
      ok: false,
      code: 'launchFailed'
    })
    expect(spawned.calls).toHaveLength(1)
  })

  it('찾아보기: .exe가 아니면 받지 않고 설정을 그대로 둔다', async () => {
    for (const file of [
      'C:\\Android\\bin\\studio.bat',
      'C:\\x\\code.cmd',
      'C:\\x\\a.lnk',
      'C:\\x\\a.ps1'
    ]) {
      executables.add(file)
      const state = await setEditor({ kind: 'browse', title: 't' }, deps(), async () => file)
      expect(state).toMatchObject({ kind: 'system', error: 'unsupportedFile' })
    }
    expect(await readEditorSettings(settingsFile)).toEqual({ kind: 'system' })
    // 취소
    const cancelled = await setEditor({ kind: 'browse', title: 't' }, deps(), async () => null)
    expect(cancelled.kind).toBe('system')
    expect(cancelled).not.toHaveProperty('error')
  })

  it('찾아보기로 고른 .exe는 기본 인자의 custom이 되고, 인자를 바꾸고 초기화할 수 있다', async () => {
    const exe = 'C:\\Program Files\\Notepad++\\notepad++.exe'
    executables.add(exe)
    const chosen = await setEditor(
      { kind: 'browse', title: '편집기 고르기' },
      deps(),
      async () => exe
    )
    expect(chosen).toEqual({
      kind: 'custom',
      detectedId: null,
      exe,
      args: DEFAULT_CUSTOM_ARGS,
      defaultArgs: DEFAULT_CUSTOM_ARGS,
      detected
    })

    const args = '-n$(Line) "$(File)"'
    expect(await setEditor({ kind: 'customArgs', args }, deps(), async () => null)).toMatchObject({
      kind: 'custom',
      args
    })
    expect(await openInExternalEditor(FILE, PROJECT, 4, deps())).toEqual({ ok: true })
    expect(spawned.calls[0]).toMatchObject({ exe, argv: ['-n4', FILE], options: { cwd: PROJECT } })

    // $(File)이 없는 인자는 받지 않는다
    expect(
      await setEditor({ kind: 'customArgs', args: '-n$(Line)' }, deps(), async () => null)
    ).toMatchObject({ args, error: 'invalidArgs' })
    expect(await setEditor({ kind: 'resetArgs' }, deps(), async () => null)).toMatchObject({
      args: DEFAULT_CUSTOM_ARGS
    })
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      kind: 'custom',
      exe,
      args: DEFAULT_CUSTOM_ARGS
    })
  })

  it('모르는 선택과 없는 편집기 id는 설정을 바꾸지 않는다', async () => {
    for (const choice of [
      { kind: 'detected', id: 'vscode' },
      { kind: 'detected', id: '../../evil' },
      { kind: 'exe', exe: 'C:\\evil.exe' },
      null,
      'system'
    ]) {
      expect(
        await setEditor(choice as never, deps(), async () => 'C:\\evil.exe'),
        JSON.stringify(choice)
      ).toMatchObject({ kind: 'system', detected })
    }
    expect(await readEditorSettings(settingsFile)).toEqual({ kind: 'system' })
  })
})
