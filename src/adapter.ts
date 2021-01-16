import * as vscode from 'vscode';
import { TestSuiteInfo, TestInfo, TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent, RetireEvent } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { loadSnort3Tests, snort3Test, runTest } from './snort3Test';
import {myStatusBarItem} from './main';

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
}
export class Snort3TestAdapter implements TestAdapter {

	private disposables: { dispose(): void }[] = [];
	public loadedTests: {suite:TestSuiteInfo, snort3Tests:Map<string,snort3Test>}=<{suite:TestSuiteInfo, snort3Tests:Map<string,snort3Test>}>{};
	private currentJobQ:jobQueue;
	private running:boolean = false;
	private loading:boolean = false;
	private cancelling:boolean = false;
	//private active_jobs:snort3Test[]=[];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();
	private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();
	private concurrency:number = 3;

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }
	get retire(): vscode.Event<RetireEvent> { return this.retireEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {
		this.log.info('Initializing snort3_test adapter for '+ workspace.uri.path);
		const watcher1=vscode.workspace.createFileSystemWatcher('**/*.{py,xml,sh,lua}',true,false,true);
		const watcher2=vscode.workspace.createFileSystemWatcher('**/*expected*',true,false,true);
		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
		this.disposables.push(watcher1);
		this.disposables.push(watcher2);
		this.currentJobQ = new jobQueue;
		watcher1.onDidChange((e)=>{ this.handleFileChange(e); });
		watcher2.onDidChange((e)=>{ this.handleFileChange(e); });
	}

	handleFileChange(file:vscode.Uri){

	}

	private findNode(searchNode: TestSuiteInfo | TestInfo, id:string)
		:TestSuiteInfo | TestInfo | undefined
	{
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	}

	async load(): Promise<void> {
		if(this.loading){
			this.log.warn(this.workspace.uri.path+': Another load in progress.');
			return Promise.resolve();
		}
		return new Promise((resolve)=>{
			this.loading = true;
			this.log.info(this.workspace.uri.path+': Loading snort3 tests...');
			myStatusBarItem.text=`$(beaker) $(sync~spin)Loading...`;
			this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
			loadSnort3Tests(this.workspace).then((value)=>{
				this.log.info(this.workspace.uri.path+': Tests loaded.')
				this.loadedTests = value;
				this.testsEmitter.fire((<TestLoadFinishedEvent>{ type: 'finished', suite: this.loadedTests.suite }));
			}).catch((err:string)=>{
				this.log.info(this.workspace.uri.path+': '+err);
				this.testsEmitter.fire((<TestLoadFinishedEvent>{ type: 'finished' }));
			}).finally(()=>{
				myStatusBarItem.text=`$(beaker) Snort3 Tests`;
				this.loading = false;
				this.retireEmitter.fire({});
				resolve();
			});
		});
	}

	async run(tests: string[]): Promise<void> {
		if(this.cancelling) {
			this.log.info("Can't schedule now, wait till cancelling is done.");
			return;
		}
		this.log.info(`Scheduling snort3 tests ${JSON.stringify(tests)}`);
		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
		myStatusBarItem.text=`$(beaker) $(sync~spin)Queuing jobs...`;
		for (const suiteOrTestId of tests) {
			const node = this.findNode(this.loadedTests.suite, suiteOrTestId);
			if (node) this.currentJobQ.post(node);
		}
		myStatusBarItem.text=`$(beaker) Snort3 Tests`;
		if(this.running) return;
		this.running = true;
		var PromisePool = require('es6-promise-pool');
		const self = this;
		var testJobProducer = function () {
			const node = self.currentJobQ.next();
			if(node)
			{
				const test = self.loadedTests.snort3Tests.get(node.id);
				return runTest(node.id,test,self.testStatesEmitter);
			}
			else return null;
		}
		  
		var test_pool = new PromisePool(testJobProducer, this.concurrency);
		myStatusBarItem.text=`$(beaker) $(sync~spin)Running...`;
		await test_pool.start();
		myStatusBarItem.text=`$(beaker) Snort3 Tests`;
		this.running=false;
		this.cancelling = false;
		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
		return;	
	}

/*	implement this method if your TestAdapter supports debugging tests
	async debug(tests: string[]): Promise<void> {
		// start a test run in a child process and attach the debugger to it...
	}
*/

	cancel(): void {
		this.log.info('Cancelling all scheduled jobs...');
		this.cancelling = true;
		this.currentJobQ.flush();
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}
}
