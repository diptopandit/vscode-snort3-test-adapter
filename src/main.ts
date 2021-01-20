import * as vscode from 'vscode';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { Snort3TestAdapter} from './adapter';
export var myStatusBarItem: vscode.StatusBarItem;
export async function activate(context: vscode.ExtensionContext) {

	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];

	// create a simple logger that can be configured with the configuration variables
	// `exampleExplorer.logpanel` and `exampleExplorer.logfile`
	const log = new Log('snort3TestExplorer', workspaceFolder, 'Snort3 Test Explorer');
	context.subscriptions.push(log);

	// get the Test Explorer extension
	const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
	if (log.enabled) log.info(`Snort3 Test Explorer ${testExplorerExtension ? '' : 'not '}found`);

	if (testExplorerExtension) {
		const testHub = testExplorerExtension.exports;
		myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
		myStatusBarItem.text=`$(beaker) Snort3 Tests`;
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
