import * as vscode from 'vscode';
import * as fs from 'fs';
import { TestSuiteInfo, TestInfo, TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent, RetireEvent } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { loadSnort3Tests, snort3Test, runTest } from './snort3Test';
import {myStatusBarItem, buildtool} from './main';
import * as path from 'path';

class jobQueue {
	private jobdata = new Array<TestInfo|TestSuiteInfo>();

	public next():TestInfo|undefined{
		const nextElement = this.jobdata.shift();
		if(nextElement)
		{
			if(nextElement.type==='test')
				return nextElement;
			else if(nextElement.type==='suite')
			{
				var children = nextElement.children.slice();
				var tmp = children.pop();
				while(tmp !== undefined)
				{
					this.jobdata.unshift(tmp);
					tmp = children.pop();
				}
				return this.next();
			}
		}
		return;
	}

	public post(newJob:TestInfo|TestSuiteInfo):number{
		return this.jobdata.push(newJob);
	}

	public flush(){
		this.jobdata.splice(0);
	}

	public dispose(){
		this.flush();
	}
}

export class Snort3TestAdapter implements TestAdapter {
	private disposables: { dispose(): void }[] = [];
	public loadedTests: {suite:TestSuiteInfo, testDetails:Map<string,snort3Test>} =
		<{suite:TestSuiteInfo, testDetails:Map<string,snort3Test>}>{};
	private currentJobQ:jobQueue = new jobQueue;
	private running:boolean = false;
	private loading:boolean = false;
	private cancelling:boolean = false;

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();
	private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();
	private isTestReady:boolean = false;
	private isTestRoot:boolean = false;

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }
	get retire(): vscode.Event<RetireEvent> { return this.retireEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {
		this.log.info('Initializing snort3_test adapter for '+ workspace.uri.path);
		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
		this.disposables.push(this.retireEmitter);
		this.disposables.push(this.currentJobQ);
		this.isTestRoot = this.is_test_root();
		if(this.isTestRoot)
		{
			const watcher1=vscode.workspace.createFileSystemWatcher('**/*.{py,xml,sh,lua}',true,false,true)
				.onDidChange((e)=>{ this.handleFileChange(e); });
			const watcher2=vscode.workspace.createFileSystemWatcher('**/*expected*',true,false,true)
				.onDidChange((e)=>{ this.handleFileChange(e); });
			
			this.disposables.push(watcher1);
			this.disposables.push(watcher2);
			this.isTestReady = this.validate_config();
		} else {
			this.dispose();
		}
	}

	private is_test_root():boolean{
		try{
			fs.accessSync(this.workspace.uri.path + '/bin/snorttest.py', fs.constants.R_OK);
			return true;
		} catch {
			return false;
		}
	}
	private validate_config():boolean{
		let snort_binary = buildtool.get_sf_prefix_snort3()+'/bin/snort';
		try{
			fs.accessSync(snort_binary, fs.constants.R_OK);
		} catch(e)
		{
			this.log.warn(this.workspace.uri.path+": "+e);
				vscode.window.showWarningMessage("Snort binary missing. \
				Make sure sf_prefix_snort3 setting is correct and snort binary is present in that path.");
			return false;
		}
		try{
			fs.accessSync(buildtool.get_dependencies(), fs.constants.R_OK);
		} catch(e)
		{
			this.log.warn(this.workspace.uri.path+": "+e);
			vscode.window.showWarningMessage("Dependencies not accessible.");
			return false;
		}
		//don't care if this fails due to unavailable file handle
		try{
			fs.watch(snort_binary,(event)=>{
				if(event == 'change') this.retireEmitter.fire({});
			});
		} finally {
			return true;
		}
	}

	private handleFileChange(file:vscode.Uri){
		const changed_test = this.findNode(this.loadedTests.suite, path.dirname(file.path));
		if(changed_test)
		{
			if(changed_test.type=='test' && file.path.substring(file.path.lastIndexOf('/') + 1)=== 'test.xml'){
				const test=this.loadedTests.testDetails.get(changed_test.id);
				if(test) test.reload();
			}
			this.retireEmitter.fire({tests:[changed_test.id]});
		}
	}

	private findNode(searchNode: TestSuiteInfo | TestInfo, id:string)
		:TestSuiteInfo | TestInfo | undefined
	{
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found) return found;
			}
		}
		return undefined;
	}

	async load(): Promise<void> {
		if(!this.isTestRoot || !this.validate_config()){
			this.isTestReady = false;
			this.testsEmitter.fire((<TestLoadFinishedEvent>{ type: 'finished' }));
			return ;
		}
		this.isTestReady = true;
		if(this.loading)
			return;

		return new Promise((resolve)=>{
			this.loading = true;
			this.log.info(this.workspace.uri.path+': Loading snort3 tests...');
			myStatusBarItem.text=`$(sync~spin)`;
			this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
			loadSnort3Tests(this.workspace).then((value)=>{
				this.log.info(this.workspace.uri.path+': Tests loaded.')
				this.loadedTests = value;
				this.testsEmitter.fire((<TestLoadFinishedEvent>{ type: 'finished', suite: this.loadedTests.suite }));
			}).catch((err:string)=>{
				this.log.info(this.workspace.uri.path+': '+err);
				this.testsEmitter.fire((<TestLoadFinishedEvent>{ type: 'finished' }));
			}).finally(()=>{
				myStatusBarItem.text=`$(beaker)`;
				this.loading = false;
				this.retireEmitter.fire({});
				resolve();
			});
		});
	}

	async run(tests: string[]): Promise<void> {
		if(!this.isTestRoot || !this.validate_config()){
			this.isTestReady = false;
			return;
		}
		if(this.cancelling) {
			this.log.info("Can't schedule now, wait till cancelling is done.");
			return;
		}
		this.log.info(`Scheduling snort3 tests ${JSON.stringify(tests)}`);
		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
		for (const suiteOrTestId of tests) {
			const node = this.findNode(this.loadedTests.suite, suiteOrTestId);
			if (node) this.currentJobQ.post(node);
		}
		if(this.running) return;
		this.running = true;
		const self = this;
		const testJobProducer = function () {
			const node = self.currentJobQ.next();
			if(node)
			{
				const test = self.loadedTests.testDetails.get(node.id);
				return runTest(test,self.testStatesEmitter);
			}
			else return;
		}
		const PromisePool = require('es6-promise-pool');
		var test_pool = new PromisePool(testJobProducer, buildtool.get_concurrency());
		myStatusBarItem.text=`$(beaker~spin)`;
		test_pool.start().then(()=>{
			myStatusBarItem.text=`$(beaker)`;
			this.running=false;
			this.cancelling = false;
			this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
		});
		return;	
	}

/*	implement this method to run snort with gdb debugging tests */
/*
async debug(tests: string[]): Promise<void> {
		// start a test run in a child process and attach the debugger to it...
	}
*/

	cancel(): void {
		if(!this.isTestReady) return;
		this.log.info('Cancelling all scheduled jobs...');
		this.cancelling = true;
		this.currentJobQ.flush();
		this.loadedTests.testDetails.forEach((value)=>{
			value.abort();
		});
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}
