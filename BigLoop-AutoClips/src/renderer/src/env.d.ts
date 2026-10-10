import type { BigLoopApi } from '@shared/api'

declare global {
  interface Window {
    bigloop: BigLoopApi
  }
}
export {}
