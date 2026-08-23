export type { MusicBuildResult, MusicBuildSpec, MusicBuildStage } from './types'
export { specFromPrompt } from './spec'
export { validateMidiClip, validateBuildNotes } from './validator'
export { executeMusicBuild, specToProjectPlan } from './executor'
