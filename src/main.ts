import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { Snort3TestAdapter} from './adapter';
export var myStatusBarItem: vscode.StatusBarItem;
export var buildtool:any;
export async function activate(context: vscode.ExtensionContext) {

	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

	const log = new Log('snort3TestExplorer', workspaceFolder, 'Snort3 Test Explorer');
	context.subscriptions.push(log);

	// get the Test Explorer extension
	const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
	if (log.enabled) log.info(`Snort3 Test Explorer ${testExplorerExtension ? '' : 'not '}found`);
	const snort3BuildTools = vscode.extensions.getExtension('diptopandit.snort3-build-tools');
	if (log.enabled) log.info(`Snort3 Build tools ${snort3BuildTools ? '' : 'not '}found`);

	if (testExplorerExtension && snort3BuildTools) {
		const testHub = testExplorerExtension.exports;
		buildtool = snort3BuildTools.exports;
		myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,buildtool.get_status_priority()+1);
		myStatusBarItem.text=`$(beaker)`;
		context.subscriptions.push(myStatusBarItem);
		myStatusBarItem.show();
		// this will register an ExampleTestAdapter for each WorkspaceFolder
		context.subscriptions.push(new TestAdapterRegistrar(
			testHub,
			workspaceFolder => new Snort3TestAdapter(workspaceFolder, log),
			log
		));
	}
}
