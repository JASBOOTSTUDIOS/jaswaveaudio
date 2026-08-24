export type { MusicBuildResult, MusicBuildSpec, MusicBuildStage, MusicBuildAiPartial, MusicSection } from './types'
export { specFromPrompt, mergeMusicBuildSpec, buildMusicBuildSpec, normalizeAiSections } from './spec'
export { validateMidiClip, validateBuildNotes } from './validator'
export { executeMusicBuild, specToProjectPlan, expandSectionsToBarPlan } from './executor'
