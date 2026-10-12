import { useEffect } from 'react'

type Props = {
  message: string
  visible: boolean
  onHide: () => void
}

export function Toast({ message, visible, onHide }: Props) {
  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(onHide, 2000)
    return () => window.clearTimeout(t)
  }, [visible, onHide, message])

  return (
    <div id="toast" className={visible ? 'show' : ''} role="status">
      {message}
    </div>
  )
}
