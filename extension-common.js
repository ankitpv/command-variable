const vscode = require('vscode');
const UUID = require('./uuid');
const utils = require('./utils');

let rememberStore = { __not_yet: "I don't remember", empty: "" };

function storeStringRemember(args, result) {
  if (result !== undefined) {
    let argkey = utils.getProperty(args, 'key', '__unknown');
    if (!utils.isString(result)) {
      result = result.value;
      if (utils.isObject(result)) {
        for (const vkey in result) {
          if (result.hasOwnProperty(vkey)) {
            rememberStore[vkey] = result[vkey];
          }
        }
        return getRememberKey(argkey);
      }
    }
    rememberStore[argkey] = result;
  }
  return result !== undefined ? result : utils.getProperty(args, 'default', 'Escaped');
}

function getRememberKey(key) { return utils.getProperty(rememberStore, key, rememberStore['__not_yet']); }

function getNamedWorkspaceFolder(name, workspaceFolder, editor) {
  const folders = utils.dblQuest(vscode.workspace.workspaceFolders, []);
  if (!name) {
    if (editor) { return workspaceFolder; }
    if (folders.length === 1) { return workspaceFolder; }
    utils.errorMessage('Use the name of the Workspace Folder in the variable or argument');
    return undefined;
  }
  let filterPred = w => w.name === name;
  if (name.indexOf('/') >= 0) { filterPred = w => w.uri.path.endsWith(name); }
  let wsfLst = folders.filter(filterPred);
  if (wsfLst.length === 0) {
    utils.errorMessage(`Workspace not found with name: ${name}`);
    return undefined;
  }
  return wsfLst[0];
};
function activeTextEditorVariable(action, args, noEditor, editorOptional) {
  const editor = vscode.window.activeTextEditor;
  if (!editorOptional) {
    if (!editor) { return utils.errorMessage('No editor', noEditor); }
  }
  return action(editor, args);
};
function activeWorkspaceFolder(action, noWorkSpace, editorOptional) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return utils.errorMessage('No folder open', noWorkSpace); }
  return activeTextEditorVariable( editor => {
    let folder = undefined;
    if (editor) {
      folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    } else {
      folder = folders[0];  // choose first folder in the list
    }
    return folder ? action(folder, editor) : utils.fileNotInFolderError(noWorkSpace);
  }, undefined, undefined, editorOptional);
};
function activeWorkspaceFolderEditorOptional(action, noWorkSpace, workspaceName) {
  const editorOptional = true;
  return activeWorkspaceFolder( (workspaceFolder, editor) => {
    workspaceFolder = getNamedWorkspaceFolder(workspaceName, workspaceFolder, editor);
    if (!workspaceFolder) { return 'Unknown'; }
    return action(workspaceFolder, editor);
  }, noWorkSpace, editorOptional);
};
function toString(obj) {
  if (utils.isString(obj)) { return obj; }
  if (utils.isObject(obj)) {
    let elements = [];
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        elements.push(`${key}="${obj[key]}"`);
      }
    }
    return elements.join(', ');
  }
  return obj.toString();
}
async function pickStringRemember(args) {
  let qpItems = [];
  for (const option of utils.getProperty(args, 'options', ['item1', 'item2'])) {
    let qpItem = undefined;
    if (utils.isString(option)) {
      qpItem = {value:option, label:option};
    }
    if (utils.isArray(option) && (option.length === 2)) {
      qpItem = {value:option[1], label:option[0], description:toString(option[1])};
    }
    if (qpItem) { qpItems.push(qpItem); }
  }
  let result = await vscode.window.showQuickPick(qpItems, { placeHolder: utils.getProperty(args, 'description', 'Choose:') });
  return storeStringRemember(args, result);
}
async function promptStringRemember(args) {
  let result = await vscode.window.showInputBox({ prompt: utils.getProperty(args, 'description', 'Enter:'), password: utils.getProperty(args, 'password', false) });
  return storeStringRemember(args, result);
}
function getExpressionFunctionFilterSelection(expr) {
  try {
    return Function(`"use strict";return (function calcexpr(value, index, numSel) {
      return ${expr};
    })`)();
  }
  catch (ex) {
    vscode.window.showErrorMessage("extension.commandvariable.selectedText: Incomplete expression");
  }
}
function concatMapSelections(args, map_func) {
  args = args || {};
  let separator = utils.getProperty(args, 'separator', '\n');
  let selectionFilter = getExpressionFunctionFilterSelection(utils.getProperty(args, 'filterSelection', 'true'));
  return activeTextEditorVariable( editor => {
    let numSel = editor.selections.length;
    return editor.selections.sort((a, b) => { return a.start.compareTo(b.start); })
        .map( s => map_func(editor, s) )
        .filter ( (value, index) => selectionFilter(value, index, numSel))
        .join(separator);
  });
};
function getEditorSelection(editor, selection) {
  var document = editor.document;
  var selectStart = document.offsetAt(selection.start);
  var selectEnd = document.offsetAt(selection.end);
  return document.getText().substring(selectStart, selectEnd);
};

function activate(context) {
  const getProperty = utils.getProperty;
  const range = utils.range;
  const dblQuest = utils.dblQuest;

  var basenameNUp = function (dirUriPath, n) {
    const rootParts = dirUriPath.split('/');
    if (n > rootParts.length-2) { vscode.window.showErrorMessage('Not enough parent directories'); return "Unknown"; }
    return rootParts[rootParts.length - (n+1)];
  };
  var workspaceFolderBasenameNUp = function (n, args) {
    return activeWorkspaceFolderEditorOptional( workspaceFolder => {
      return basenameNUp(workspaceFolder.uri.path, n);
    }, undefined, args !== undefined ? args.name : undefined);
  };
  var fileDirBasenameNUp = function (n) {
    return activeTextEditorVariable( editor => {
      const path = editor.document.uri.path;
      const lastSep = path.lastIndexOf('/');
      if (lastSep === -1) { return "Unknown"; }
      return basenameNUp(path.substring(0, lastSep), n);
    });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.file.fileDirBasename', () => {
      return fileDirBasenameNUp(0);
    })
  );
  context.subscriptions.push( ...range(5, 1).map(
    i => vscode.commands.registerCommand(`extension.commandvariable.file.fileDirBasename${i}Up`,
        () => fileDirBasenameNUp(i) )) );
  context.subscriptions.push( ...range(5, 1).map(
    i => vscode.commands.registerCommand(`extension.commandvariable.workspace.folderBasename${i}Up`,
        (args) => workspaceFolderBasenameNUp(i, args) )) );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.selectedText', args => {
      return concatMapSelections(args, getEditorSelection);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.currentLineText', args => {
      return concatMapSelections(args, (editor, selection) => {
        return editor.document.lineAt(selection.start).text;
      });
    })
  );
  var positionLineColumn = function (kind, lineChar) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No editor'); return '1'; }
    var position = (kind==='start') ? editor.selection.start : editor.selection.end;
    return (( lineChar==='line' ? position.line : position.character ) + 1 ).toString();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.selectionStartLineNumber', () => { return positionLineColumn('start', 'line'); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.selectionStartColumnNumber', () => { return positionLineColumn('start', 'column'); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.selectionEndLineNumber', () => { return positionLineColumn('end', 'line'); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.selectionEndColumnNumber', () => { return positionLineColumn('end', 'column'); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.pickStringRemember', args => { return pickStringRemember(args); })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.promptStringRemember', args => { return promptStringRemember(args); })
  );
  function rememberCommand(args) {
    args = utils.dblQuest(args, {});
    args.key = utils.getProperty(args, 'key', 'empty');
    return storeStringRemember(args, { value: utils.getProperty(args, 'store', {}) });
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.remember', args => rememberCommand(args) )
  );
  context.subscriptions.push(
    // TODO Deprecated 2021-10
    vscode.commands.registerCommand('extension.commandvariable.rememberPick', args => rememberCommand(args) )
  );
  let dateTimeFormat = (args) => {
    args = dblQuest(args, {});
    let locale = getProperty(args, 'locale', undefined);
    let options = getProperty(args, 'options', undefined);
    let template = getProperty(args, 'template', undefined);
    let parts = new Intl.DateTimeFormat(locale, options).formatToParts(new Date());
    if (!template) { return parts.map(({type, value}) => value).join(''); }
    let dateTimeFormatParts = {};
    parts.forEach(({type, value}) => { dateTimeFormatParts[type] = value; });
    return template.replace(/\${(\w+)}/g, (match, p1) => { return getProperty(dateTimeFormatParts, p1, ''); });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.dateTime', args => dateTimeFormat(args))
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('extension.commandvariable.dateTimeInEditor', function (editor, edit, args) {
      edit.replace(editor.selection, dateTimeFormat(args));
    })
  );
  let uuidv4 = undefined;
  let UUIDFormat = args => {
    args = dblQuest(args, {});
    if (getProperty(args, 'use', 'new') === 'new') { uuidv4 = UUID.genV4(); }
    if (!uuidv4) { return 'Unknown'; }
    switch (getProperty(args, 'output', 'hexString')) {
      case 'hexString': return uuidv4.hexString;
      case 'hexNoDelim': return uuidv4.hexNoDelim;
      case 'bitString': return uuidv4.bitString;
      case 'urn': return uuidv4.urn;
    }
    return 'Unknown';
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.commandvariable.UUID', args => UUIDFormat(args))
  );
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('extension.commandvariable.UUIDInEditor', function (editor, edit, args) {
      edit.replace(editor.selection, UUIDFormat(args));
    })
  );
};

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  storeStringRemember,
  getRememberKey,
  getNamedWorkspaceFolder,
  activeTextEditorVariable,
  activeWorkspaceFolder,
  activeWorkspaceFolderEditorOptional,
  pickStringRemember,
  promptStringRemember,
  concatMapSelections,
  getEditorSelection
}
