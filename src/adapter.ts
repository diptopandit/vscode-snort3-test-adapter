import * as vscode from 'vscode';
import { TestSuiteInfo, TestInfo, TestAdapter, TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { loadSnort3Tests, snort3Test, runTest } from './snort3Test';

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
				var tmp = nextElement.children.pop();
				while(tmp !== undefined)
				{
					this.jobdata.unshift(tmp);
					tmp = nextElement.children.pop();
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
export class ExampleAdapter implements TestAdapter {

	private disposables: { dispose(): void }[] = [];
	public loadedTests: {suite:TestSuiteInfo, snort3Tests:Map<string,snort3Test>}=<{suite:TestSuiteInfo, snort3Tests:Map<string,snort3Test>}>{};
	private currentJobQ:jobQueue;
	private running:boolean = false;
	//private active_jobs:snort3Test[]=[];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();
	private concurrency:number = 3;

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		private readonly log: Log
	) {

		this.log.info('Initializing snort3_test adapter');

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);
		this.currentJobQ = new jobQueue;

	}

	private findNode(searchNode: TestSuiteInfo | TestInfo, id:string):TestSuiteInfo | TestInfo | undefined {
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
		this.log.info('Loading snort3 tests');
		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
		this.loadedTests= await loadSnort3Tests(this.workspace);
		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.loadedTests.suite });
	}

	async run(tests: string[]): Promise<void> {
		this.log.info(`Running snort3 tests ${JSON.stringify(tests)}`);
		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
		for (const suiteOrTestId of tests) {
			const node = this.findNode(this.loadedTests.suite, suiteOrTestId);
			if (node) this.currentJobQ.post(node);
		}
		if(this.running) return Promise.resolve();
		this.running = true;
		var PromisePool = require('es6-promise-pool')
		const self = this;
		var promiseProducer = function () {
			const node = self.currentJobQ.next();
			if(node)
			{
				const test = self.loadedTests.snort3Tests.get(node.id);
				return runTest(node.id,test,self.testStatesEmitter);
			}
			else return null;
		}
		  
		var pool = new PromisePool(promiseProducer, this.concurrency)
		  
		await pool.start()

		this.running=false;
		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });	
	}

/*	implement this method if your TestAdapter supports debugging tests
	async debug(tests: string[]): Promise<void> {
		// start a test run in a child process and attach the debugger to it...
	}
*/

	cancel(): void {
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
