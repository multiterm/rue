import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

const TIPS: ReadonlyArray<string> = [
  'Try /search to search the web',
  'Try /tldr to summarize',
  'Drop a PDF onto the input to attach it',
  '⌘, opens settings',
  'Try /think for step-by-step reasoning',
  'Paste an image into the input to attach a screenshot',
  'Esc to dismiss'
]

export function TipBar() {
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length))

  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 5_000)
    return () => clearInterval(t)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.5 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none px-3 pb-1.5 text-center text-[11px] text-muted-foreground"
    >
      {TIPS[tipIdx]}
    </motion.div>
  )
}
