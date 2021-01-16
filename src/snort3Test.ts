import * as vscode from 'vscode';
import * as fs from 'fs';
import * as convert from 'xml-js';
import * as child_process from 'child_process';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';

export class snort3Test {
	private testData:any;
	private active_child:child_process.ChildProcess|undefined;
	constructor(xmlPath:string){
		const xmlFile = fs.readFileSync(xmlPath, 'utf8');
		this.testData = JSON.parse(convert.xml2json(xmlFile, {compact: true, spaces: 2})); 
	}

	getName():string {return this.testData["snort-test"].name._text;}
	getDescription():string {return this.testData["snort-test"].description._text;}
	execute(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const num = (Math.floor(Math.random() * 9)+1).toString();
			this.active_child=child_process.spawn('sleep',[num]).once('exit', () => {
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'passed' });
				resolve();
			});
		});
	}

	abort()
	{
		if(undefined !== this.active_child) this.active_child.kill();
	}
}

export async function loadSnort3Tests(rootdir:vscode.WorkspaceFolder)
	:Promise<{suite:TestSuiteInfo,snort3Tests:Map<string,snort3Test>}>
{
	var sampleTestSuit: TestSuiteInfo = {
		type: 'suite',
		id: 'Snort3_test_root',
		label: 'Snort3_test_root',
		children: []
	};
	var snort3Tests = new Map<string,snort3Test>();
	const getLastItem = (thePath: string) => thePath.substring(thePath.lastIndexOf('/') + 1)
	var walk = function(dir:string) {
		var list = fs.readdirSync(dir);
		if(list.includes('test.xml')){
			//leaf
			const file:string = dir + '/test.xml';
			const thisTest = new snort3Test(file);
			snort3Tests.set(dir,thisTest);
			return <TestInfo>{type: 'test',
				id: dir,
				label: getLastItem(dir),
				file: file,
				description: thisTest.getName(),
				tooltip:thisTest.getName() + thisTest.getDescription()
			};
		} else {
			var result:TestSuiteInfo={
				type:'suite',
				id:dir,
				label:getLastItem(dir),
				children:[]
			};
			list.forEach(function(file) {
				file = dir + '/' + file;
				var stat = fs.statSync(file);
				if (stat && stat.isDirectory()) {
					var node = walk(file);
					if(node !== undefined)
						result.children.push(node);
				}
			});
			if(result.children.length>0)
				return result;
			return undefined;
		}
	}
	try
	{
		fs.accessSync(rootdir.uri.path + '/bin/snorttest.py', fs.constants.R_OK);
		var suite=walk(rootdir.uri.path);
		if(suite !== undefined)
		{
			sampleTestSuit.children.push(suite);
			return Promise.resolve({suite:sampleTestSuit,snort3Tests:snort3Tests});
		}
		return Promise.reject("No tests present under this root.");
	}
	catch
	{
		return Promise.reject("Not a snort3 test root directory.");
	}
}

export function runTest(id:string, test:snort3Test|undefined,
	testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
	TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
{
	testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'running' });
	if(test) return test.execute(id,testStatesEmitter);
	else return Promise.resolve();
}
