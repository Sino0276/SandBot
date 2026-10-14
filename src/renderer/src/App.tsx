import { useEffect } from 'react'
import DialogHost from './editor/DialogHost'
import EditorLayout from './editor/EditorLayout'
import { initHistory } from './editor/history'
import { initProjectSession } from './project/projectActions'
import { askLengthUnitOnFirstRun } from './units/unitStore'

function App(): React.JSX.Element {
  useEffect(() => {
    initHistory()
    initProjectSession()
    void askLengthUnitOnFirstRun()
  }, [])

  return (
    <>
      <EditorLayout />
      <DialogHost />
    </>
  )
}

export default App
