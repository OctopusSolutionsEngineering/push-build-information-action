import { getInput, isDebug } from '@actions/core'
import { context } from '@actions/github'
import { Commit, PushEvent } from '@octokit/webhooks-types/schema'
import { Octokit } from '@octokit/core'
import {
  BuildInformationRepository,
  Client,
  CreateOctopusBuildInformationCommand,
  IOctopusBuildInformationCommit,
  PackageIdentity
} from '@octopusdeploy/api-client'
import { InputParameters } from './input-parameters'
import AntPathMatcher from 'ant-path-matcher'

export async function pushBuildInformationFromInputs(
  client: Client,
  runId: number,
  parameters: InputParameters
): Promise<void> {
  // get the branch name
  let branch: string = parameters.branch || context.ref
  if (branch.startsWith('refs/heads/')) {
    branch = branch.substring('refs/heads/'.length)
  }

  const repoUri = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`
  const pushEvent = context.payload as PushEvent | undefined
  const commits: IOctopusBuildInformationCommit[] =
    (await filterCommits(pushEvent?.commits, parameters.paths)).map((commit: Commit) => {
      return {
        Id: commit.id,
        Comment: commit.message
      }
    }) || []

  const packages: PackageIdentity[] = []
  for (const packageId of parameters.packages) {
    packages.push({
      Id: packageId,
      Version: parameters.version
    })
  }

  if (isDebug()) {
    client.info(`Commits ${pushEvent?.commits.map(c => JSON.stringify(c, null, 2)).join('\n')}`)
  }

  // If there are mo matching commits, but we did specify some paths, we have nothing to add to the build information
  if (parameters.paths) {
    if (!commits || commits.length === 0) {
      client.info('None of the commits match the paths, so no build information will be pushed to Octopus')
      return
    }

    if (isDebug()) {
      client.info(
        `Matched the following commits:\n${commits
          .map((commit: IOctopusBuildInformationCommit) => commit.Id)
          .join('\n')}`
      )
    }
  }

  const command: CreateOctopusBuildInformationCommand = {
    spaceName: parameters.space,
    BuildEnvironment: 'GitHub Actions',
    BuildNumber: context.runNumber.toString(),
    BuildUrl: `${repoUri}/actions/runs/${runId}`,
    Branch: branch,
    VcsType: 'Git',
    VcsRoot: `${repoUri}`,
    VcsCommitNumber: context.sha,
    Commits: commits,
    Packages: packages
  }

  if (isDebug()) {
    client.info(`Build Information:\n${JSON.stringify(command, null, 2)}`)
  }

  const repository = new BuildInformationRepository(client, parameters.space)
  await repository.push(command, parameters.overwriteMode)

  client.info('Successfully pushed build information to Octopus')
}

export async function filterCommits(
  commits: Commit[] | undefined | null,
  paths: string[] | undefined | null
): Promise<Commit[]> {
  if (!commits) {
    return []
  }

  if (!paths) {
    return commits
  }

  const matcher = new AntPathMatcher()

  const matchingCommits: Commit[] = []
  for (const commit of commits) {
    const modifiedPaths = await getPaths(commit.id)
    if (paths.some((path: string) => modifiedPaths.some((added: string) => matcher.match(path, added)))) {
      matchingCommits.push(commit)
    }
  }

  return matchingCommits
}

async function getPaths(commitSha: string): Promise<string[]> {
  // Get the GitHub token
  const githubToken = getInput('GITHUB_TOKEN')

  // Initialize Octokit
  const octokit = new Octokit({ auth: githubToken })

  // Get the commit information
  const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    owner: context.repo.owner,
    repo: context.repo.repo,
    ref: commitSha
  })

  return commit.files?.map(file => file.filename) || []
}
