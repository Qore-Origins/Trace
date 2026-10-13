'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

// Keep lifecycle animations progressing in the isolated QA window even when
// Windows marks the Electron window as occluded or backgrounded.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

function requiredAbsolutePath(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`Missing or invalid isolated Electron path: ${name}`)
  }
  return path.resolve(value)
}

function canonicalWindowsPath(value) {
  return path.resolve(value)
    .replace(/^\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
    .toLocaleLowerCase('en-US')
}

const runRoot = requiredAbsolutePath('TRACE_PHASE2_QA_ROOT')
const runRootInfo = fs.lstatSync(runRoot)
if (!runRootInfo.isDirectory() || runRootInfo.isSymbolicLink() || canonicalWindowsPath(fs.realpathSync(runRoot)) !== canonicalWindowsPath(runRoot)) {
  throw new Error('QA run directory is not the exact expected directory')
}
const userDataPath = path.join(runRoot, 'user-data')
const sessionDataPath = path.join(runRoot, 'session-data')
const logsPath = path.join(runRoot, 'logs')
const crashDumpsPath = path.join(runRoot, 'crash-dumps')
const libraryPath = path.join(runRoot, 'disposable-library')
const mainBundlePath = requiredAbsolutePath('TRACE_PHASE2_QA_MAIN_BUNDLE')

for (const directory of [userDataPath, sessionDataPath, logsPath, crashDumpsPath]) {
  fs.mkdirSync(directory, { recursive: true })
  const directoryInfo = fs.lstatSync(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || canonicalWindowsPath(fs.realpathSync(directory)) !== canonicalWindowsPath(directory)) {
    throw new Error('Electron profile directory is not the exact expected directory')
  }
}

const libraryInfo = fs.lstatSync(libraryPath)
if (!libraryInfo.isDirectory() || libraryInfo.isSymbolicLink() || canonicalWindowsPath(fs.realpathSync(libraryPath)) !== canonicalWindowsPath(libraryPath)) {
  throw new Error('Disposable library is not the exact expected directory')
}

app.setPath('userData', userDataPath)
app.setPath('sessionData', sessionDataPath)
app.setPath('logs', logsPath)
app.setPath('crashDumps', crashDumpsPath)

for (const [name, expected] of [
  ['userData', userDataPath],
  ['sessionData', sessionDataPath],
  ['logs', logsPath],
  ['crashDumps', crashDumpsPath]
]) {
  if (canonicalWindowsPath(app.getPath(name)) !== canonicalWindowsPath(expected)) {
    throw new Error(`Electron ${name} path escaped this QA run`)
  }
}

const configPath = path.join(userDataPath, 'config.json')
if (fs.existsSync(configPath) || process.env.TRACE_PHASE2_QA_ONBOARDING !== '1') {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (typeof config.root_dir !== 'string' || canonicalWindowsPath(config.root_dir) !== canonicalWindowsPath(libraryPath)) {
    throw new Error('Electron config does not point at this QA run disposable library')
  }
}

if (!fs.statSync(mainBundlePath).isFile()) {
  throw new Error('Production Electron main bundle is missing')
}

process.stdout.write('TRACE_PHASE2_QA_ISOLATION_VERIFIED\n')
require(mainBundlePath)
