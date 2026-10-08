import { applyPreviewCsp } from './policy.mjs'

export function onPreBuild({ netlifyConfig, utils }) {
  try {
    applyPreviewCsp(netlifyConfig, process.env)
  } catch (error) {
    utils.build.failBuild(error.message)
  }
}

