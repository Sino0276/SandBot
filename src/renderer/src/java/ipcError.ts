// ipcRenderer.invoke의 거부 메시지 앞에 붙는 "Error invoking remote method '<채널>': " 을 뗀다
export function ipcErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}
