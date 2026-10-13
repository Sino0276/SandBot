import { useEffect } from 'react'
import DialogHost from './editor/DialogHost'
import EditorLayout from './editor/EditorLayout'
import { initProjectSession } from './project/projectActions'

function App(): React.JSX.Element {
  useEffect(() => {
    initProjectSession()
  }, [])

  return (
    <>
      <EditorLayout />
      <DialogHost />
    </>
  )
}

export default App
