import type { BigLoopApi } from '@shared/types'

declare global {
  interface Window {
    bigloop: BigLoopApi
  }
}
export {}
