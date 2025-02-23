import { context } from '@actions/github'
import { Client, ClientConfiguration, Logger } from '@octopusdeploy/api-client'
import * as inputs from '../src/input-parameters'
import * as octopus from '../src/push-build-information'
import { CaptureOutput } from './test-helpers'
import { Commit } from '@octokit/webhooks-types/schema'
import { filterCommits } from '../src/push-build-information'

const apiClientConfig: ClientConfiguration = {
  userAgentApp: 'Test',
  apiKey: process.env.OCTOPUS_TEST_API_KEY || 'API-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  instanceURL: process.env.OCTOPUS_TEST_URL || 'http://localhost:8050'
}

describe('inputs', () => {
  it('successfully get input parameters', async () => {
    const inputParameters = inputs.get(false)
    expect(inputParameters != undefined)
  }, 100000)
})

describe('build information', () => {
  it('successfully pushes build information', async () => {
    const output = new CaptureOutput()

    const logger: Logger = {
      debug: message => output.debug(message),
      info: message => output.info(message),
      warn: message => output.warn(message),
      error: (message, err) => {
        if (err !== undefined) {
          output.error(err.message)
        } else {
          output.error(message)
        }
      }
    }

    const config: ClientConfiguration = {
      userAgentApp: 'Test',
      instanceURL: apiClientConfig.instanceURL,
      apiKey: apiClientConfig.apiKey,
      logging: logger
    }

    const client = await Client.create(config)

    const inputParameters = inputs.get(false)
    const runId = context.runId
    if (runId === undefined) {
      throw new Error('GitHub run number is not defined')
    }
    await octopus.pushBuildInformationFromInputs(client, runId, inputParameters)
  }, 100000)
})

describe('filterCommits', () => {
  function buildCommit(added: string): Commit {
    return {
      id: '1',
      message: 'Initial commit',
      added: [added],
      modified: [],
      removed: [],
      tree_id: '',
      author: {
        date: '',
        name: '',
        email: ''
      },
      url: '',
      committer: {
        email: '',
        name: '',
        date: ''
      },
      distinct: true,
      timestamp: ''
    }
  }

  const commits: Commit[] = [
    buildCommit('src/index.ts'),
    buildCommit('README.md'),
    buildCommit('old-file.ts')
  ]

  it('should return all commits if no paths are defined', () => {
    const result = filterCommits(commits, [])
    expect(result.length).toEqual(3)
  })

  it('should return all commits if the paths are undefined', () => {
    const result = filterCommits(commits, null)
    expect(result.length).toEqual(3)
  })

  it('should return all commits if a catch all wildcard is defined', () => {
    const result = filterCommits(commits, ['**/*'])
    expect(result.length).toEqual(3)
  })

  it('should return commits that match the given paths', () => {
    const result = filterCommits(commits, ['src/index.ts', 'README.md'])
    expect(result.length).toEqual(2)
    expect(result[0].added[0]).toEqual(commits[0].added[0])
    expect(result[1].added[0]).toEqual(commits[1].added[0])
  })

  it('should return commits that match the given wildcard paths', () => {
    const result = filterCommits(commits, ['src/**/*.ts', 'README.md'])
    expect(result.length).toEqual(2)
    expect(result[0].added[0]).toEqual(commits[0].added[0])
    expect(result[1].added[0]).toEqual(commits[1].added[0])
  })

  it('should return commits that match the markdown file', () => {
    const result = filterCommits(commits, ['**/*.md'])
    expect(result.length).toEqual(1)
    expect(result[0].added[0]).toEqual(commits[1].added[0])
  })

  it('should return an empty array if no commits match the given paths', () => {
    const result = filterCommits(commits, ['non-existent-path'])
    expect(result.length).toEqual(0)
  })

  it('should return an empty array if no commits were defined', () => {
    const result = filterCommits(null, null)
    expect(result.length).toEqual(0)
  })

  it('should return commits that match added, modified, or removed paths', () => {
    const result = filterCommits(commits, ['old-file.ts'])
    expect(result.length).toEqual(1)
    expect(result[0].added[0]).toEqual(commits[2].added[0])
  })
})