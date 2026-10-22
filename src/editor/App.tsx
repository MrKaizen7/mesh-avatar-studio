import { useEffect, useRef, useState } from 'react';
import fixture from 'virtual:sample-rig';
import { EditorCanvas } from './EditorCanvas';
import { deleteRigItem, drawRigPart, duplicateRigItem, resizeRigToImage, setAt, transformRigCluster, type DrawTool } from './model';
import { type Point, type Rig, parseRig, validateRig } from 'mesh-avatar';
import { Preview } from './Preview';
import { RigHistory, downloadRig } from './history';
import { openProjectFolder, openLocalProject, copySample, localProjects, projectAction, sampleImagesAvailable, sampleSourceUrl, repositoryContext, runProjectJob, ProjectJobError, importAvatar, exportAvatar, imageAsPng, createImageProject, requestAutoRig, type ProjectJob, type LocalProject, type LocalProjectEntry } from './project';
import { ExportAvatar, ImportAvatar } from './AvatarTransfer';
import { archiveText } from './archive-i18n';
import { folderOpenError } from './folder-errors';
import { layerSignature } from './stale';
import { RigFields } from './RigFields';
import { GROUPS, partPresent } from './parts';
import { PartList } from './PartList';
import { GUIDE_KEY, I18nProvider, readPreference, savePreference, useI18n, type PartGroup } from './i18n';
import { FirstGuide, GuideSteps, Help } from './Guide';
import { Icon } from './Icon';
import { RecentProjects } from './RecentProjects';
import { AskAgent } from './AskAgent';
import { VariantsPanel } from './VariantsPanel';
import { JobFeedback } from './JobFeedback';
import { CopyButton } from './CopyButton';
import { readRecent, addRecent, saveRecent, REOPEN_KEY, pickDirectory, hasDirectoryPicker, directoryFiles,
  keepDirectory, restoreDirectory, forgetDirectory, clearDirectories, type RecentProject, type ProjectDirectory } from './recent-projects';
import { autoRigImage, completeAutoRigDraft, type AutoRigDraft, type AutoRigStage } from './auto-rig';
import './style.css';
import { liveText } from '../live/i18n';

type EditorError = { kind: 'invalidRig' | 'invalidFolder' | 'missingFolderFiles' | 'unreadableFolder' | 'unreadableProject' | 'invalidValue' | 'saveError' | 'revealError' | 'copyError' | 'continueError'; paths: string[] };
function errorPaths(value: string) { return [...new Set(value.match(/rig(?:\.[\w]+|\[\d+\])+/g) ?? [])]; }

export function App() { return <I18nProvider><Workspace /></I18nProvider>; }
function Workspace() {
  const { t, parts, language, locale, setLanguage, title } = useI18n();
  const openMenu = useRef<HTMLDetailsElement>(null);
  const [guide, setGuide] = useState(() => readPreference(GUIDE_KEY) !== '1');
  const [help, setHelp] = useState(false);
  const [history] = useState(() => new RigHistory(parseRig(fixture)));
  const [rig, setRig] = useState(history.present);
  const [savedRig, setSavedRig] = useState(() => JSON.stringify(history.present));
  const pickedFiles = useRef<File[] | undefined>(undefined);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState<{ error?: string; name?: string } | null>(null);
  const sharing = archiveText[language];
  const [builtSignature, setBuiltSignature] = useState(() => layerSignature(history.present));
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const projectOpened = useRef(false);
  const requestedProjectOpened = useRef(false);
  const objectUrls = useRef<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [assets, setAssets] = useState<Record<string, string> | undefined>(undefined);
  const [projects, setProjects] = useState<LocalProjectEntry[] | null>(null);
  const [localProject, setLocalProject] = useState<LocalProject | null>(null);
  const [pickedName, setPickedName] = useState('');
  const [notice, setNotice] = useState<{ key: 'savedTo' | 'missingRecent' | 'variantsReloaded' | 'reloadFailed'; path?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [rootPath, setRootPath] = useState<string>();
  const [focusRequest, setFocusRequest] = useState<{ group: string; id: number }>();
  const [mouthSprites, setMouthSprites] = useState(true), [mouthRequest, setMouthRequest] = useState(0);
  const [job, setJob] = useState<ProjectJob | null>(null);
  const [autoRigBusy, setAutoRigBusy] = useState(false);
  const [autoRigDraft, setAutoRigDraft] = useState<AutoRigDraft | null>(null);
  const [autoRigStage, setAutoRigStage] = useState<AutoRigStage | 'creatingProject' | 'requestingAutoRig'>('loadingModel');
  const [autoRigError, setAutoRigError] = useState<string | null>(null);
  const [imageProjectError, setImageProjectError] = useState<string | null>(null);
  const [autoRigWarnings, setAutoRigWarnings] = useState<string[] | null>(null);
  const jobRef = useRef<ProjectJob | 'transfer' | null>(null);
  const [rebuildError, setRebuildError] = useState<ProjectJobError | null>(null);
  useEffect(() => { void repositoryContext().then(context => { setRootPath(context?.rootPath); }); }, []);
  const [recent, setRecent] = useState(readRecent);
  const [reopen, setReopen] = useState(() => readPreference(REOPEN_KEY) !== '0');
  const remember = (entry: RecentProject) => {
    setRecent(current => {
      const next = addRecent(current, entry); saveRecent(next);
      for (const item of current) if (!next.some(value => value.id === item.id)) void forgetDirectory(item.id);
      return next;
    });
  };
  const deleteSelectedItem = () => {
    if (!selectedCluster || !selectedCluster.includes('.')) return;
    update(deleteRigItem(rig, selectedCluster));
    setSelected(selectedGroup ?? null);
  };
  const duplicateSelectedItem = () => {
    if (!selectedCluster || !selectedCluster.includes('.')) return;
    const duplicated = duplicateRigItem(rig, selectedCluster);
    if (!duplicated) return;
    update(duplicated.rig);
    setSelected(duplicated.path);
  };
  const removeRecent = (id: string) => {
    setRecent(current => { const next = current.filter(item => item.id !== id); saveRecent(next); return next; });
    void forgetDirectory(id);
  };
  useEffect(() => {
    let active = true;
    void localProjects().then(async list => {
      if (!active) return;
      setProjects(list);
      const requestedProjectName = new URLSearchParams(window.location.search).get('project');
      const requestedProject = list?.find(project => project.name === requestedProjectName);
      if (requestedProject && !requestedProject.error && !requestedProjectOpened.current && !projectOpened.current) {
        requestedProjectOpened.current = true;
        projectOpened.current = true;
        await openLocal(requestedProject, true);
        const url = new URL(window.location.href);
        url.searchParams.delete('project');
        window.history.replaceState(null, '', url);
        return;
      }
      const entries = readRecent();
      const missing = list ? entries.filter(entry => entry.kind === 'server' && !list.some(project => project.name === entry.serverName)) : [];
      const available = entries.filter(entry => !missing.includes(entry));
      if (missing.length) { setRecent(available); saveRecent(available); setNotice({ key: 'missingRecent', path: missing.map(entry => entry.name).join(', ') }); }
      if (readPreference(REOPEN_KEY) === '0' || !available.length || projectOpened.current) return;
      const latest = available[0];
      if (latest.kind === 'server') {
        const project = list?.find(item => item.name === latest.serverName);
        if (project && !project.error) { projectOpened.current = true; await openLocal(project, true); }
      } else if (latest.hasHandle) {
        const handle = await restoreDirectory(latest.id);
        if (!active || !handle) return;
        try {
          if (await handle.queryPermission({ mode: 'read' }) === 'granted' && active && !projectOpened.current) {
            projectOpened.current = true; await openFolder(await directoryFiles(handle), handle);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') { removeRecent(latest.id); setNotice({ key: 'missingRecent', path: latest.name }); }
          // Permission prompts are reserved for a click on the recent entry.
        }
      }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer); }, [notice]);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    sampleImagesAvailable().then(available => {
      if (cancelled) return;
      if (available && !projectOpened.current) setSourceUrl(sampleSourceUrl);
      setChecking(false);
    });
    return () => { cancelled = true; objectUrls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const [visible, setVisible] = useState<string[]>([...GROUPS]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [clusterTransform, setClusterTransform] = useState({ x: 0, y: 0, scale: 100, rotation: 0 });
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [guideName, setGuideName] = useState('');
  const [dragStale, setDragStale] = useState<boolean | null>(null);
  const [error, setError] = useState<EditorError | null>(null);
  const update = (next: Rig) => {
    if (jobRef.current) return;
    const errors = validateRig(next);
    if (errors.length) { setError({ kind: 'invalidValue', paths: errorPaths(errors.join('\n')) }); return; }
    setError(null);
    history.change(next);
    setRig(history.present);
  };
  const applyClusterTransform = () => {
    if (!selectedCluster) return;
    update(transformRigCluster(rig, selectedCluster, {
      x: clusterTransform.x,
      y: clusterTransform.y,
      scale: clusterTransform.scale / 100,
      rotation: clusterTransform.rotation * Math.PI / 180,
    }));
  };
  const runAutoRig = async () => {
    if (!sourceUrl || jobRef.current || saving || autoRigBusy) return;
    setAutoRigBusy(true);
    setAutoRigError(null);
    setImageProjectError(null);
    setAutoRigWarnings(null);
    setAutoRigDraft(null);
    try {
      let result: { rig: AutoRigDraft; warnings: string[] };
      if (localProject && !localProject.readOnly) {
        setAutoRigStage('requestingAutoRig');
        result = await requestAutoRig(localProject, rig.head);
      } else {
        result = await autoRigImage(sourceUrl, 0, setAutoRigStage, rig);
      }
      if (result.rig.image.width !== rig.image.width || result.rig.image.height !== rig.image.height) {
        throw new Error('The source image dimensions do not match the loaded rig.');
      }
      const next = completeAutoRigDraft(result.rig, rig);
      const errors = validateRig(next);
      if (errors.length) throw new Error(`Generated rig is invalid:\n${errors.join('\n')}`);
      setAutoRigDraft(result.rig);
      setAutoRigWarnings(result.warnings);
    } catch (failure) {
      setAutoRigError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setAutoRigBusy(false);
    }
  };
  const startImageProject = async (file?: File) => {
    if (!file || !rootPath || jobRef.current || saving || autoRigBusy) return;
    setAutoRigBusy(true);
    setAutoRigError(null);
    setAutoRigWarnings(null);
    try {
      const png = await imageAsPng(file);
      const bitmap = await createImageBitmap(png);
      let imageRig: Rig;
      try { imageRig = resizeRigToImage(rig, bitmap.width, bitmap.height); }
      finally { bitmap.close(); }
      const name = file.name.replace(/\.[^.]+$/, '');
      setAutoRigStage('creatingProject');
      const result = await createImageProject(png, name, imageRig);
      if (!await openLocal(result.project)) throw new Error('The new image project could not be opened.');
      setProjects(await localProjects());
      setSelected('head');
      setAutoRigDraft(null);
      setAutoRigWarnings(null);
      setImageProjectError(result.layerBuildError ?? null);
      if (result.layerBuildError) setBuiltSignature('');
    } catch (failure) {
      setImageProjectError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setAutoRigBusy(false);
    }
  };
  const applyAutoRigSuggestion = () => {
    if (!autoRigDraft) return;
    const next = completeAutoRigDraft(autoRigDraft, rig);
    const errors = validateRig(next);
    if (errors.length) {
      setAutoRigError(`Generated rig is invalid:\n${errors.join('\n')}`);
      return;
    }
    update(next);
    setSelected('head');
    setAutoRigDraft(null);
  };
  const openFile = async (file?: File) => {
    if (!file || jobRef.current || localProject?.hasSource === false) return;
    try {
      setDrawTool(null);
      update(parseRig(JSON.parse(await file.text())));
      setSelected(null);
      setLocalProject(null);
    } catch (error) { setError({ kind: 'invalidRig', paths: errorPaths(String(error)) }); }
  };
  const openFolder = async (files: File[], handle?: ProjectDirectory) => {
    if (jobRef.current) return false;
    setOpening(true);
    try {
      const project = await openProjectFolder(files);
      projectOpened.current = true;
      if (project.rig) {
        history.load(project.rig); setRig(history.present); setDragStale(null);
        setSavedRig(JSON.stringify(project.rig));
        setBuiltSignature(layerSignature(project.rig));
      }
      setDrawTool(null);
      setSelected(null);
      objectUrls.current.forEach(url => URL.revokeObjectURL(url));
      objectUrls.current = project.urls;
      setSourceUrl(project.sourceUrl);
      setAssets(project.assets);
      setLocalProject(null);
      pickedFiles.current = files;
      setPickedName(files[0]?.webkitRelativePath.split('/')[0] || t.openProject);
      setChecking(false);
      setError(null);
      setRebuildError(null);
      const name = handle?.name || files[0]?.webkitRelativePath.split('/')[0] || t.openProject;
      let id = `folder:${name}`;
      if (handle) {
        id = `folder:${crypto.randomUUID()}`;
        for (const entry of recent.filter(item => item.kind === 'folder' && item.hasHandle)) {
          const previous = await restoreDirectory(entry.id);
          try { if (previous && await handle.isSameEntry(previous)) { id = entry.id; break; } } catch { /* An old handle may no longer exist. */ }
        }
      }
      const hasHandle = handle ? await keepDirectory(id, handle) : false;
      if (!hasHandle) id = `folder:${name}`;
      remember({ id, name, kind: 'folder', relativePath: name, lastOpened: new Date().toISOString(), hasHandle });
      if (openMenu.current) openMenu.current.open = false;
      return true;
    } catch (error) { setError(folderOpenError(error)); return false; }
    finally { setOpening(false); }
  };
  const openLocal = async (entry: LocalProjectEntry, automatic = false): Promise<boolean> => {
    if (jobRef.current) return false;
    if (entry.error) { setError({ kind: 'unreadableProject', paths: [entry.error.code, entry.error.path] }); return false; }
    setOpening(true);
    try {
      const project = await openLocalProject(entry);
      projectOpened.current = true;
      history.load(project.rig!); setRig(history.present); setDragStale(null); setBuiltSignature(layerSignature(project.rig!));
      setDrawTool(null);
      setSavedRig(JSON.stringify(project.rig)); pickedFiles.current = undefined;
      setSelected(null); setLocalProject(entry); setPickedName('');
      objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current = [];
      setSourceUrl(project.sourceUrl); setAssets(project.assets); setChecking(false); setError(null);
      setRebuildError(null);
      if (!automatic) setNotice(null);
      remember({ id: `server:${entry.name}`, kind: 'server', name: entry.name, serverName: entry.name,
        relativePath: entry.relativePath, lastOpened: new Date().toISOString() });
      if (openMenu.current) openMenu.current.open = false;
      return true;
    } catch {
      if (automatic) { removeRecent(`server:${entry.name}`); setNotice({ key: 'missingRecent', path: entry.name }); }
      else setError({ kind: 'invalidFolder', paths: [] });
      return false;
    }
    finally { setOpening(false); }
  };
  const saveRef = useRef<() => void>(() => undefined);
  const save = async () => {
    if (jobRef.current) return;
    if (localProject?.hasSource === false) return;
    if (!localProject || localProject.readOnly) { downloadRig(history.present); return; }
    if (saving) return;
    setSaving(true);
    const snapshot = JSON.stringify(history.present);
    try { const result = await projectAction(localProject, 'rig', history.present); setSavedRig(snapshot); setNotice({ key: 'savedTo', path: result.path }); setError(null); }
    catch { setError({ kind: 'saveError', paths: [] }); }
    finally { setSaving(false); }
  };
  saveRef.current = () => { void save(); };
  const reveal = async () => {
    if (!localProject) return;
    try { await projectAction(localProject, 'reveal'); setError(null); }
    catch { setError({ kind: 'revealError', paths: [] }); }
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setHelp(false); setDrawTool(null); if (openMenu.current) openMenu.current.open = false; }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (jobRef.current) { if (['s', 'z'].includes(event.key.toLowerCase())) event.preventDefault(); return; }
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); saveRef.current(); }
      if (!typing && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setRig(event.shiftKey ? history.redo() : history.undo());
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [history]);
  const selectPart = (group: string) => {
    setDrawTool(null);
    setSelectedHandles([]);
    setSelected(group);
    setGuideName(group === 'accessories' ? `Accessory ${(rig.accessories?.length ?? 0) + 1}`
      : group === 'guides' ? '' : `${parts[group as PartGroup]?.[0] ?? group} guide`);
    setVisible(current => current.includes(group) ? current : [...current, group]);
  };
  const drawPart = (tool: DrawTool, start: Point, end: Point) => {
    const group = selected?.split('.')[0] as PartGroup | undefined;
    const next = drawRigPart(rig, tool, start, end, guideName, group && group !== 'guides' ? group : undefined);
    update(next);
    if (tool === 'strand') setSelected(`strands.${(next.strands?.length ?? 1) - 1}`);
    else if (tool === 'bunL' || tool === 'bunR') setSelected(`buns.${tool}`);
    else if (tool === 'shoulder') setSelected(`body.shoulders.${next.body.shoulders.length - 1}`);
    else if (tool === 'softBody') setSelected(`softBody.regions.${(next.softBody?.regions.length ?? 1) - 1}`);
    else if (tool === 'accessory') setSelected(`accessories.${(next.accessories?.length ?? 1) - 1}`);
    else {
      setSelected(`guides.${(next.guides?.length ?? 1) - 1}`);
      setGuideName('');
    }
    setDrawTool(null);
  };
  const selectedRoot = selected?.split('.')[0];
  const selectedGroup = selectedRoot as PartGroup | undefined;
  const selectedCluster = selected ? (() => {
    const segments = selected.split('.');
    const numericIndex = segments.findIndex((segment, index) => index > 0 && /^\d+$/.test(segment));
    return numericIndex >= 0 ? segments.slice(0, numericIndex + 1).join('.') : selected;
  })() : undefined;
  const selectedPart = selectedGroup && parts[selectedGroup];
  const itemCanBeDeleted = !!selectedCluster && /^(buns\.(bunL|bunR)|strands\.\d+|accessories\.\d+|guides\.\d+|body\.shoulders\.\d+|softBody\.regions\.\d+)$/.test(selectedCluster);
  const itemCanBeDuplicated = itemCanBeDeleted && (
    !selectedCluster?.startsWith('buns.') ||
    !rig.buns?.[selectedCluster.endsWith('bunL') ? 'bunR' : 'bunL']
  );
  const selectedPartMissing = !!selectedGroup && selectedGroup !== 'guides' && !partPresent(rig, selectedGroup);
  const showGuideEditor = selectedGroup === 'guides';
  const guideItems = (rig.guides ?? []).map((guide, index) => ({ guide, index }))
    .filter(({ guide }) => selectedGroup === 'guides' || guide.part === selectedGroup);
  const deleteGuide = (index: number) => {
    const next = structuredClone(rig);
    next.guides?.splice(index, 1);
    if (!next.guides?.length) delete next.guides;
    update(next);
    if (selectedGroup === 'guides') setSelected('guides');
  };
  const currentLayers = JSON.parse(layerSignature(rig)), builtLayers = JSON.parse(builtSignature);
  const changed = Object.keys(currentLayers).filter(key => JSON.stringify(currentLayers[key]) !== JSON.stringify(builtLayers[key]));
  const errorNotice = error && <p role="alert" className="error">{t[error.kind]} {error.paths.join(', ')}</p>;
  const dismissGuide = () => { setGuide(false); savePreference(GUIDE_KEY, '1'); };
  const chooseFile = async (folder: boolean) => {
    if (jobRef.current) return;
    if (openMenu.current) openMenu.current.open = false;
    if (folder && hasDirectoryPicker()) {
      try { const handle = await pickDirectory(); await openFolder(await directoryFiles(handle), handle); }
      catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setError(folderOpenError(error)); }
    } else (folder ? folderInput : fileInput).current!.click();
  };
  const openRecent = async (entry: RecentProject) => {
    if (entry.kind === 'server') {
      const list = await localProjects(); setProjects(list);
      if (list) {
        const project = list.find(item => item.name === entry.serverName);
        if (!project) { removeRecent(entry.id); setNotice({ key: 'missingRecent', path: entry.name }); return; }
        await openLocal(project); return;
      }
    } else if (entry.hasHandle) {
      const handle = await restoreDirectory(entry.id);
      if (handle) {
        try {
          const permission = await handle.queryPermission({ mode: 'read' });
          if (permission !== 'granted' && await handle.requestPermission({ mode: 'read' }) !== 'granted') return;
          await openFolder(await directoryFiles(handle), handle); return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') { removeRecent(entry.id); setNotice({ key: 'missingRecent', path: entry.name }); return; }
          setError(folderOpenError(error)); return;
        }
      }
    }
    await chooseFile(true);
  };
  const recentControl = <RecentProjects recent={recent} projects={projects} reopen={reopen}
    onOpen={entry => { void openRecent(entry); }} onRemove={removeRecent}
    onClear={() => { setRecent([]); saveRecent([]); void clearDirectories(); }}
    onReopen={value => { setReopen(value); savePreference(REOPEN_KEY, value ? '1' : '0'); }} />;
  const reloadInPlace = async (entry: LocalProject) => {
    const list = await localProjects(), fresh = list?.find(item => item.name === entry.name);
    if (!fresh || fresh.error) throw new ProjectJobError('toolFailed', t.reloadFailed);
    const loaded = await openLocalProject(fresh);
    // Keep the canvas mounted, its view, selection and the existing undo/redo stack.
    history.replacePresent(loaded.rig!); setRig(history.present); setDragStale(null);
    setSavedRig(JSON.stringify(loaded.rig));
    setBuiltSignature(layerSignature(loaded.rig!)); setAssets(loaded.assets); setLocalProject(fresh); setProjects(list); setRebuildError(null);
  };
  useEffect(() => {
    if (!import.meta.hot || !localProject) return;
    const entry = localProject;
    let active = true, revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = ({ name }: { name: string }) => {
      if (name !== entry.name || jobRef.current) return;
      const generation = ++revision;
      clearTimeout(timer);
      const reload = async (attempt = 0) => {
        if (!active || generation !== revision || jobRef.current) return;
        try {
          const list = await localProjects(), fresh = list?.find(item => item.name === entry.name);
          if (!fresh || fresh.error) throw new Error('Project unavailable');
          const loaded = await openLocalProject(fresh);
          if (!active || generation !== revision || jobRef.current) return;
          // Sprite changes must not discard unsaved outlines, selection, view or undo history.
          setAssets(loaded.assets); setLocalProject(fresh); setProjects(list);
          setNotice({ key: 'variantsReloaded' });
        } catch {
          if (!active || generation !== revision || jobRef.current) return;
          if (attempt < 3) timer = setTimeout(() => { void reload(attempt + 1); }, 600 * (attempt + 1));
          else setNotice({ key: 'reloadFailed' });
        }
      };
      timer = setTimeout(() => { void reload(); }, 300);
    };
    import.meta.hot.on('studio:variants-changed', changed);
    return () => { active = false; clearTimeout(timer); import.meta.hot?.off('studio:variants-changed', changed); };
  }, [localProject?.name]);
  const runJob = async (action: ProjectJob, files?: File[]) => {
    if (!localProject || localProject.readOnly || jobRef.current || saving) throw new ProjectJobError('toolFailed');
    jobRef.current = action; setJob(action);
    try {
      const result = await runProjectJob(localProject, action, history.present, files);
      if (action !== 'variant-requests') {
        try { await reloadInPlace(localProject); }
        catch { throw new ProjectJobError('reloadFailed', t.reloadFailed); }
      }
      return result;
    } finally { jobRef.current = null; setJob(null); }
  };
  const sampleEditing = !!localProject?.readOnly || (!localProject && !pickedName);
  const listedProject = !localProject && pickedName ? projects?.find(project => !project.error && !project.readOnly && project.name === pickedName && project.relativePath.startsWith('projects/')) : undefined;
  const continueEditing = async () => {
    if (jobRef.current || saving || opening) return;
    const edited = structuredClone(history.present), previousSignature = builtSignature;
    jobRef.current = 'transfer'; setOpening(true); setError(null);
    try {
      const entry = sampleEditing ? await copySample(edited) : listedProject;
      if (!entry || entry.error) throw new Error('Project unavailable');
      const loaded = await openLocalProject(entry);
      // The copied layers still reflect the sample's original outlines, not the edited rig.
      setBuiltSignature(sampleEditing ? previousSignature : layerSignature(loaded.rig!));
      history.replacePresent(edited); setRig(history.present); setDragStale(null);
      objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current = [];
      projectOpened.current = true; setSourceUrl(loaded.sourceUrl); setAssets(loaded.assets);
      setLocalProject(entry); setPickedName(''); setChecking(false); setRebuildError(null);
      setSavedRig(JSON.stringify(loaded.rig)); pickedFiles.current = undefined;
      setProjects(await localProjects());
      remember({ id: `server:${entry.name}`, kind: 'server', name: entry.name, serverName: entry.name, relativePath: entry.relativePath, lastOpened: new Date().toISOString() });
    } catch { setError({ kind: 'continueError', paths: [] }); }
    finally { jobRef.current = null; setOpening(false); }
  };
  const playbackOnly = localProject?.hasSource === false;
  const busy = job !== null || opening || archiveBusy || autoRigBusy;
  const dirty = JSON.stringify(rig) !== savedRig;
  const writable = !!localProject && !localProject.readOnly && !playbackOnly;
  const importFile = async (file: File) => {
    if (jobRef.current || saving || opening) return;
    if (!rootPath) { setArchiveFeedback({ error: sharing.importUnavailable }); return; }
    if (openMenu.current) openMenu.current.open = false;
    jobRef.current = 'transfer'; setArchiveBusy(true); setArchiveFeedback(null);
    try {
      const entry = await importAvatar(file);
      setProjects(await localProjects());
      jobRef.current = null;
      await openLocal(entry);
      setArchiveFeedback({ name: entry.name });
    } catch (error) { setArchiveFeedback({ error: error instanceof Error ? error.message : sharing.failed }); }
    finally { jobRef.current = null; setArchiveBusy(false); }
  };
  const exportFile = async (includeSource: boolean) => {
    if (jobRef.current || saving || opening) return;
    jobRef.current = 'transfer'; setArchiveBusy(true); setArchiveFeedback(null);
    try {
      if (writable && dirty) {
        const snapshot = JSON.stringify(history.present);
        await projectAction(localProject!, 'rig', history.present); setSavedRig(snapshot);
      }
      const name = localProject?.name ?? (pickedName || 'sample-miko-qipao');
      const blob = await exportAvatar(name, includeSource, pickedFiles.current);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${name}.mavatar`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setArchiveFeedback({ error: error instanceof Error ? error.message : sharing.failed }); throw error; }
    finally { jobRef.current = null; setArchiveBusy(false); }
  };
  const importControl = <ImportAvatar busy={busy || saving} available={!!rootPath} onImport={file => { void importFile(file); }} />;
  return <main onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file?.name.toLowerCase().endsWith('.mavatar')) void importFile(file); else if (file?.type.startsWith('image/')) void startImageProject(file); else void openFile(file); }}>
    <header className="toolbar">
      <div className="brand"><h1>{t.product}</h1><p>{t.subtitle}</p></div>
      <nav aria-label={t.tools}>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label={t.rigFile}
          onChange={event => { void openFile(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={t.loadImage}
          onChange={event => { void startImageProject(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={folderInput} type="file" multiple hidden aria-label={t.folderFiles} {...{ webkitdirectory: '' }}
          onChange={event => { void openFolder(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <details ref={openMenu} className="open-menu" inert={busy} onToggle={event => {
          if (event.currentTarget.open) void localProjects().then(setProjects);
        }}><summary>{t.openProject}<Icon name="chevron" /></summary>
          <div className="project-menu">{importControl}{recentControl}<p className="project-help">{t.projectHelp}</p>
            {projects && <div className="project-list" aria-label={t.localProjects}>
              {projects.length === 0 && <p>{t.noProjects}</p>}
              {projects.map(project => <button key={project.name} className={project.error ? 'unreadable-project' : undefined} disabled={opening || !!project.error} data-testid={`project-${project.name}`} onClick={() => { void openLocal(project); }}>
                <strong>{project.readOnly ? t.sampleProject : project.name}</strong><small>{project.relativePath}</small>
                <small>{project.error ? <>{t.unreadableProject} ({project.error.code}) · {project.error.path}</> : <>{t.updated}: {new Date(project.updatedAt).toLocaleString(locale)}
                  {project.hasSprites && <span className="badge">{t.drawnVariants}</span>}{project.readOnly && <span className="badge">{t.readOnly}</span>}{project.hasSource === false && <span className="badge">{sharing.playbackBadge}</span>}</>}</small>
              </button>)}
            </div>}
            <button onClick={() => { void chooseFile(true); }}>{t.openFolder}</button><button disabled={playbackOnly} onClick={() => { void chooseFile(false); }}>{t.openRig}</button>
          </div>
        </details>
        <button disabled={!rootPath || busy || saving} onClick={() => imageInput.current?.click()}>
          {autoRigBusy ? t[autoRigStage] : t.loadImage}
        </button>
        <ExportAvatar busy={busy || saving} available={!!rootPath || !!pickedFiles.current} writable={writable} dirty={dirty} stale={changed.length > 0} onExport={exportFile} />
        <button className="auto-rig-button" disabled={!sourceUrl || busy || saving || playbackOnly} onClick={() => { void runAutoRig(); }}>
          {autoRigBusy ? t[autoRigStage] : t.autoRig}
        </button>
        {dirty && <span className="badge" role="status" data-testid="unsaved-status">{t.unsavedChanges}</span>}
        <button className="icon-button" aria-label={t.save} disabled={saving || busy || playbackOnly} title={`${t.save} · ⌘S`} onClick={() => { void save(); }}><Icon name="save" /></button>
        <span className="toolbar-divider" />
        <button className="icon-button" aria-label={t.undo} title={`${t.undo} · ⌘Z`} disabled={!history.canUndo || busy || playbackOnly} onClick={() => setRig(history.undo())}><Icon name="undo" /></button>
        <button className="icon-button" aria-label={t.redo} title={`${t.redo} · ⇧⌘Z`} disabled={!history.canRedo || busy || playbackOnly} onClick={() => setRig(history.redo())}><Icon name="redo" /></button>
        <span className="toolbar-divider" />
        <a className="live-link" href={localProject || listedProject || !pickedName ? `/live.html?project=${encodeURIComponent(localProject?.name ?? listedProject?.name ?? 'sample-miko-qipao')}` : undefined}
          target="_blank" rel="noreferrer" aria-disabled={!!pickedName && !localProject && !listedProject}
          title={pickedName && !localProject && !listedProject ? liveText[language].liveUnavailable : liveText[language].title}><Icon name="live" />{liveText[language].title}</a>
        <button className="icon-button" aria-label={t.help} title={t.help} aria-expanded={help} onClick={() => setHelp(current => !current)}><Icon name="help" /></button>
        <div className="language-toggle" role="group" aria-label={t.language}>
          <button aria-label={t.english} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t.enCode}</button>
          <button aria-label={t.japanese} aria-pressed={language === 'ja'} onClick={() => setLanguage('ja')}>{t.jaCode}</button>
          <button aria-label={t.chinese} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>{t.zhCode}</button>
        </div>
      </nav>
    </header>
    {(localProject || pickedName) && <div className="project-location" data-testid="project-location">
      <strong>{localProject?.readOnly ? t.sampleProject : localProject?.name || pickedName}</strong>
      {localProject && <><CopyButton value={localProject.absolutePath} label={t.copyPath} icon />
      <button className="icon-button" aria-label={navigator.platform.includes('Mac') ? t.showFinder : t.showFolder} title={navigator.platform.includes('Mac') ? t.showFinder : t.showFolder} onClick={() => { void reveal(); }}><Icon name="folder" /></button>
      {localProject.readOnly && <span className="badge">{t.readOnly}</span>}</>}
    </div>}
    {autoRigError && <p className="error auto-rig-feedback" role="alert">{t.autoRigError}: {autoRigError}</p>}
    {imageProjectError && <div className="error auto-rig-feedback" role="alert">
      <p>{t.imageProjectError}: {imageProjectError}</p>
      {localProject && !localProject.readOnly && <button disabled={busy || saving} onClick={() => {
        void runJob('rebuild')
          .then(() => setImageProjectError(null))
          .catch(error => setImageProjectError(error instanceof Error ? error.message : String(error)));
      }}>{t.retryLayerBuild}</button>}
    </div>}
    {autoRigWarnings && <div className="auto-rig-feedback" role="status">
      <strong>{autoRigDraft ? t.autoRigSuggestionReady : t.autoRigApplied}</strong>
      <ul>{autoRigWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
      {autoRigDraft && <div className="auto-rig-actions">
        <button className="primary" onClick={applyAutoRigSuggestion}>{t.applyAutoRig}</button>
        <button onClick={() => { setAutoRigDraft(null); setAutoRigWarnings(null); }}>{t.discardAutoRig}</button>
      </div>}
    </div>}
    {notice && <div role="status" className="save-notice">{t[notice.key]}{notice.path && ` ${notice.path}`}</div>}
    {archiveFeedback && <div className={`archive-feedback${archiveFeedback.error ? ' error' : ''}`} role={archiveFeedback.error ? 'alert' : 'status'}>
      <span>{archiveFeedback.error ?? `${sharing.imported} ${archiveFeedback.name}`}</span><button onClick={() => setArchiveFeedback(null)}>{sharing.dismiss}</button>
    </div>}
    {playbackOnly && <p className="playback-notice" role="status">{sharing.playbackOnly}</p>}
    {help && <Help onClose={() => setHelp(false)} onGuide={() => { setGuide(true); setHelp(false); }} />}
    {(dragStale ?? changed.length > 0) && <div className="stale" data-testid="stale-banner"><p role="status">{localProject && !localProject.readOnly ? t.staleLocal : sampleEditing ? t.staleSample : listedProject ? t.staleListed : t.stale}</p><small>{t.changedParts}: {changed.map(key => parts[key as PartGroup]?.[0] ?? title(key)).join(' · ')}</small>
      {localProject && !localProject.readOnly ? <button className="primary" disabled={job !== null || saving} onClick={() => { setRebuildError(null); void runJob('rebuild').catch(error => setRebuildError(error instanceof ProjectJobError ? error : new ProjectJobError('toolFailed'))); }}>{job === 'rebuild' ? t.rebuilding : t.rebuild}</button> : <><small>{sampleEditing ? t.sampleRebuildReason : t.folderRebuildReason}</small>{sampleEditing || listedProject ? <button className="primary" disabled={opening || saving || job !== null || (sampleEditing && !rootPath)} onClick={() => { void continueEditing(); }}>{opening ? t.operationBusy : sampleEditing ? t.copyContinue : t.reopenListed}</button> : <p>{t.rebuildUnavailable}</p>}</>}
      {rebuildError && <JobFeedback error={rebuildError} rig={rig} />}
      {error?.kind === 'continueError' && errorNotice}
    </div>}
    {!sourceUrl && !assets && <section className="panel empty-project"><h2>{checking ? t.checking : t.emptyTitle}</h2><p>{t.projectHelp}</p><p>{t.emptyHelp}</p>{recentControl}<AskAgent newProject rootPath={rootPath} />{errorNotice}</section>}
    {(sourceUrl || assets) && <div className={`workspace${playbackOnly ? ' playback-only' : ''}`}>
      {!playbackOnly && <div className="parts-container" inert={busy}><PartList rig={rig} visible={visible} selected={selected} onSelect={selectPart} onFocus={group => { selectPart(group); setFocusRequest(current => ({ group, id: (current?.id ?? 0) + 1 })); }} onVisible={setVisible} /></div>}
      {!playbackOnly && <section className="panel editor-panel" inert={busy}>
        <div className="panel-title"><h2>{t.source}</h2><span>{rig.image.width} × {rig.image.height} {t.px}</span></div>
        <div className="canvas-stage">
          <EditorCanvas sourceUrl={sourceUrl} rig={rig} visible={visible} selected={selected} selectedHandles={selectedHandles} selectionMode={selectionMode}
            onSelect={setSelected} onSelectedHandlesChange={setSelectedHandles} onChange={update} drawTool={drawTool} onDraw={drawPart} focusRequest={focusRequest}
            onBegin={() => { history.begin(); setDragStale(changed.length > 0); }}
            onEnd={() => { history.end(); setRig(structuredClone(history.present)); setDragStale(null); }} />
          <div className="selection-toolbar" role="toolbar" aria-label={t.selectionTools}>
            <button className="icon-button" aria-label={t.selectionMode} title={selectionMode ? t.selectionModeHint : t.selectionMode}
              aria-pressed={selectionMode} onClick={() => { setDrawTool(null); setSelectionMode(current => !current); }}>
              <Icon name="select" />
            </button>
            {selected?.includes('.') && <>
              <span>{selectedCluster}</span>
              <button className="icon-button" disabled={!itemCanBeDuplicated} aria-label={t.duplicateItem} title={t.duplicateItem}
                onClick={duplicateSelectedItem}><Icon name="duplicate" /></button>
              <button className="icon-button" disabled={!itemCanBeDeleted} aria-label={t.deleteItem} title={t.deleteItem}
                onClick={deleteSelectedItem}><Icon name="trash" /></button>
            </>}
          </div>
          {guide && <FirstGuide onDismiss={dismissGuide} />}
        </div>
      </section>}
      <div className="right-column">
        <Preview key={localProject?.name ?? (pickedName || 'sample-miko-qipao')} projectKey={localProject?.name ?? (pickedName || 'sample-miko-qipao')} rig={rig} assets={assets} hasMouthSprites={mouthSprites} onDrawMouth={playbackOnly ? undefined : () => setMouthRequest(value => value + 1)} />
        {!playbackOnly && <VariantsPanel project={localProject} projectPath={localProject?.relativePath ?? (pickedName ? `<${pickedName}>` : 'samples/miko-qipao')} assets={assets} rootPath={rootPath} busy={busy || saving} stale={changed.length > 0} onRun={runJob} mouthRequest={mouthRequest} onMouthPresence={setMouthSprites} />}
        {!localProject && !pickedName && <details className="panel new-illustration"><summary>{t.newIllustration}</summary><AskAgent newProject rootPath={rootPath} /></details>}
        {!playbackOnly && <aside className="panel inspector" inert={busy}>
          <div className="selection-heading"><h2>{selectedPart?.[0] ?? t.selection}</h2></div>
          {errorNotice}
          {selectedPart ? <><p className="part-description">{selectedPart[1]}</p><p className="part-tip"><strong>{t.tip}</strong> {selectedPart[2]}</p>
            {!selectedPartMissing && selected?.includes('.') && selectedGroup !== 'mesh' && selectedGroup !== 'view' && <fieldset className="cluster-transform">
              <legend>{t.clusterTransform}</legend>
              <div className="cluster-transform-fields">
                <label>{t.moveX}<input type="number" step="1" value={clusterTransform.x}
                  onChange={event => setClusterTransform(current => ({ ...current, x: Number(event.target.value) }))} /></label>
                <label>{t.moveY}<input type="number" step="1" value={clusterTransform.y}
                  onChange={event => setClusterTransform(current => ({ ...current, y: Number(event.target.value) }))} /></label>
                <label>{t.scalePercent}<input type="number" min="1" step="5" value={clusterTransform.scale}
                  onChange={event => setClusterTransform(current => ({ ...current, scale: Number(event.target.value) }))} /></label>
                <label>{t.rotationDegrees}<input type="number" step="5" value={clusterTransform.rotation}
                  onChange={event => setClusterTransform(current => ({ ...current, rotation: Number(event.target.value) }))} /></label>
              </div>
              <button type="button" disabled={!Object.values(clusterTransform).every(Number.isFinite) || clusterTransform.scale <= 0}
                onClick={applyClusterTransform}>{t.applyTransform}</button>
            </fieldset>}
            {selectedGroup === 'strands' && <div className="draw-tools" role="group" aria-label={t.drawTools}>
              <button aria-pressed={drawTool === 'strand'} onClick={() => setDrawTool(current => current === 'strand' ? null : 'strand')}>{t.addStrand}</button>
              {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
            </div>}
            {selectedGroup === 'buns' && <div className="draw-tools bun-tools" role="group" aria-label={t.drawTools}>
              {(!rig.buns?.bunL || selected === 'buns.bunL') && <button aria-pressed={drawTool === 'bunL'}
                onClick={() => setDrawTool(current => current === 'bunL' ? null : 'bunL')}>{t.drawLeftBun}</button>}
              {(!rig.buns?.bunR || selected === 'buns.bunR') && <button aria-pressed={drawTool === 'bunR'}
                onClick={() => setDrawTool(current => current === 'bunR' ? null : 'bunR')}>{t.drawRightBun}</button>}
              {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
            </div>}
            {selectedGroup === 'accessories' && <>
              <p className="part-tip">{t.accessoryDrawHint}</p>
              <label className="guide-name">{t.accessoryName}
                <input value={guideName} onChange={event => setGuideName(event.target.value)} />
              </label>
              <div className="draw-tools" role="group" aria-label={t.drawTools}>
                <button aria-pressed={drawTool === 'accessory'} onClick={() => setDrawTool(current => current === 'accessory' ? null : 'accessory')}>{t.addAccessory}</button>
                {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
              </div>
            </>}
            {selectedGroup === 'body' && <div className="draw-tools" role="group" aria-label={t.drawTools}>
              <button aria-pressed={drawTool === 'shoulder'} onClick={() => setDrawTool(current => current === 'shoulder' ? null : 'shoulder')}>{t.drawShoulder}</button>
              {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
            </div>}
            {selectedGroup === 'softBody' && <>
              <div className="draw-tools" role="group" aria-label={t.drawTools}>
                <button disabled={(rig.softBody?.regions.length ?? 0) >= 2} aria-pressed={drawTool === 'softBody'}
                  onClick={() => setDrawTool(current => current === 'softBody' ? null : 'softBody')}>{t.addSoftBody}</button>
                {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
              </div>
              {rig.softBody && <details className="soft-body-settings" open>
                <summary>{t.softBodySettings}</summary>
                <div className="fields">{(['gain', 'maxOffset', 'frequency', 'damping'] as const).map(key =>
                  <RigFields key={key} rig={rig} path={`softBody.${key}`} onChange={(path, value) => update(setAt(rig, path, value))} />)}</div>
              </details>}
              {selected?.startsWith('softBody.regions.') && <div className="fields">
                <RigFields rig={rig} path={selected} onChange={(path, value) => update(setAt(rig, path, value))} />
              </div>}
            </>}
            {showGuideEditor && <>
              <p className="part-tip">{t.guideHint}</p>
              <label className="guide-name">{t.guideName}
                <input value={guideName} onChange={event => setGuideName(event.target.value)} />
              </label>
              <div className="draw-tools" role="group" aria-label={t.drawTools}>
                <button aria-pressed={drawTool === 'guideLine'} onClick={() => setDrawTool(current => current === 'guideLine' ? null : 'guideLine')}>{t.addGuideLine}</button>
                <button aria-pressed={drawTool === 'guideEllipse'} onClick={() => setDrawTool(current => current === 'guideEllipse' ? null : 'guideEllipse')}>{t.addGuideEllipse}</button>
                {drawTool && <button onClick={() => setDrawTool(null)}>{t.cancelDraw}</button>}
              </div>
              <ul className="guide-list">
                {guideItems.map(({ guide, index }) => <li key={`${guide.name}-${index}`}>
                  <button className="guide-select" aria-pressed={selected === `guides.${index}`} onClick={() => setSelected(`guides.${index}`)}>
                    {guide.name}{guide.part ? ` · ${parts[guide.part as PartGroup]?.[0] ?? guide.part}` : ''} · {guide.kind}
                  </button>
                  <button className="icon-button" aria-label={`${t.deleteGuide} · ${guide.name}`} title={t.deleteGuide} onClick={() => deleteGuide(index)}>×</button>
                </li>)}
              </ul>
            </>}
            {selectedGroup !== 'guides' && selectedGroup !== 'softBody' && !selectedPartMissing
              && <div className="fields">{selected && <RigFields rig={rig} path={selected} onChange={(path, value) => update(setAt(rig, path, value))} />}</div>}</>
            : <div className="selection-empty"><p>{t.selectPart}</p><GuideSteps /></div>}
        </aside>}
      </div>
    </div>}
  </main>;
}
