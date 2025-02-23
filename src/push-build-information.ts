import { isDebug } from '@actions/core'
import { context } from '@actions/github'
import { Commit, PushEvent } from '@octokit/webhooks-types/schema'
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
    filterCommits(pushEvent?.commits, parameters.paths).map((commit: Commit) => {
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

  // If there are mo matching commits, but we did specify some paths, we have nothing to add to the build information
  if (!commits && parameters.paths) {
    client.info('None of the commits match the paths, so no build information will be pushed to Octopus')
    return
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

export function filterCommits(commits: Commit[] | undefined | null, paths: string[] | undefined | null): Commit[] {
  if (!commits) {
    return []
  }

  const matcher = new AntPathMatcher()
  return commits?.filter((commit: Commit) => {
    // If no paths are defined, we match everything
    if (!paths || paths.length === 0) {
      return true
    }

    // Include only those commits that touch one or more of the paths
    return paths.some(
      (path: string) =>
        commit.added?.some((added: string) => matcher.match(path, added)) ||
        commit.modified?.some((modified: string) => matcher.match(path, modified)) ||
        commit.removed?.some((removed: string) => matcher.match(path, removed))
    )
  })
}
