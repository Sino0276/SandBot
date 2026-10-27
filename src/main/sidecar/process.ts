import { spawn, type ChildProcess } from 'child_process'
import type { HostMessage } from '../../shared/sidecarProtocol'

// 사이드카 프로세스를 다루는 작은 인터페이스. 호스트(session.ts)는 이것만 보므로 테스트에서 메모리 안의 가짜로 바꾼다.
export type ProcessExit = {
  // 종료 코드. 신호로 끝났으면 null.
  code: number | null
  signal: string | null
}

export interface SidecarProcess {
  // 메시지 하나를 한 줄로 보낸다. 끝난 프로세스에는 아무 일도 하지 않는다.
  send(message: HostMessage): void
  // 바로 끝낸다(Windows는 TerminateProcess). 이미 끝났으면 아무 일도 하지 않는다.
  kill(): void
  onStdout(listener: (chunk: string) => void): void
  onStderr(listener: (chunk: string) => void): void
  // 프로세스가 끝나고 stdout·stderr를 다 읽은 뒤 한 번
  onExit(listener: (exit: ProcessExit) => void): void
}

export type SpawnSidecar = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<SidecarProcess>

class ChildSidecar implements SidecarProcess {
  private exited = false

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    // 사이드카가 먼저 끝나면 쓰기가 EPIPE로 실패한다. 결과는 종료 처리가 정한다.
    child.stdin?.on('error', () => undefined)
    child.on('close', () => {
      this.exited = true
    })
  }

  send(message: HostMessage): void {
    const stdin = this.child.stdin
    if (this.exited || !stdin || stdin.destroyed || stdin.writableEnded) return
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  kill(): void {
    if (this.exited) return
    this.child.kill('SIGKILL')
  }

  onStdout(listener: (chunk: string) => void): void {
    this.child.stdout?.on('data', listener)
  }

  onStderr(listener: (chunk: string) => void): void {
    this.child.stderr?.on('data', listener)
  }

  onExit(listener: (exit: ProcessExit) => void): void {
    // 'close'는 stdio를 다 읽은 뒤에 온다('exit'는 stdout이 남아 있을 수 있다)
    this.child.on('close', (code, signal) => listener({ code, signal }))
  }
}

// 셸 없이 실행한다(경로가 명령으로 해석되지 않게). 실행되면(spawn) 돌려주고, 실행하지 못하면(실행 파일 없음 등) 실패한다.
export const spawnSidecar: SpawnSidecar = (command, args, options) =>
  new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      reject(error)
      return
    }
    const onError = (error: Error): void => reject(error)
    child.once('error', onError)
    child.once('spawn', () => {
      child.removeListener('error', onError)
      // 'error' 처리기는 남긴다(나중 오류가 처리되지 않으면 메인 프로세스가 죽는다)
      child.on('error', () => undefined)
      resolve(new ChildSidecar(child))
    })
  })
