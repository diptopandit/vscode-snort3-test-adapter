import * as vscode from 'vscode';
import * as fs from 'fs';
import * as convert from 'xml-js';
import * as child_process from 'child_process';
import {buildtool} from './main';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';

const getLastItem = (thePath: string) => thePath.substring(thePath.lastIndexOf('/') + 1)

export interface snort3Test {
	getName():string;
	getDescription():string;
	execute(testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>;
	reload():Promise<void>;
	abort():void;
}

class snort3SpellCheck implements snort3Test {
	private readonly name:string = '';
	private readonly description:string = '';
	private readonly out_file:string = '';
	private readonly type:"source"|"manual";
	private active_child:child_process.ChildProcess|undefined;
	constructor(
		private readonly id:string,
		private readonly testpath:string,
		private readonly target:string)
	{
		this.name = getLastItem(this.testpath);
		this.description = 'Checks spell in ' + this.target;
		this.type = <"source"|"manual">getLastItem(this.testpath);
		this.out_file = 'unknown_'+this.type+'.txt';
	}
	getName():string {return this.name;}
	getDescription():string {return this.description;}
	execute(testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'running' });
			
			if(fs.existsSync(this.testpath+'/'+this.out_file))
				fs.unlinkSync(this.testpath+'/'+this.out_file);

			let find_args:string = ' -name';
			if(this.type === 'source') find_args += ' *.cc -o -name *.[ch]';
			else find_args += ' *.txt ! -name *CMakeLists.txt ! -name *config_changes.txt';

			let xargs = ' | xargs -I {}';
			if(this.type === 'source') xargs += ' strdump -c {} |';

			let spell_cmd = ' hunspell -l -p exception';
			if(this.type === 'manual') spell_cmd += ' {}';

			const sort_cmd = ' sort -u -o '+this.out_file+' '+this.out_file;

			const command = 'find ' + this.target + find_args + xargs + spell_cmd + ' >> ' + this.out_file + ';' + sort_cmd;

			const runner = child_process.spawn('bash', ['-c', command], {cwd: this.testpath}).once('exit', (code, signal)=>{
				this.active_child = undefined;
				if(code || signal){
					testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'errored' });
					resolve();
				}
				const diff = child_process.spawnSync('diff',['expected',this.out_file],{cwd:this.testpath});
				if(!diff.pid || diff.signal) testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'errored' });
				else if (diff.status)
					testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'failed', tooltip:diff.stdout.toString() });
				else
				{
					testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'passed' });
					fs.unlink(this.testpath+'/'+this.out_file,()=>{});
				}
				resolve();
			});

			if(!runner || !runner.pid){
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.id, state: 'errored' });
				resolve();
			}
			this.active_child = runner;
		});
	}

	reload():Promise<void>
	{
		return Promise.resolve();
	}

	abort(){
		if(this.active_child) this.active_child.kill()
	}
}

class snort3RegTest implements snort3Test {
	private testData:any;
	private active_child:child_process.ChildProcess|undefined;
	private readonly executor:string;
	constructor( 
		private readonly xmlPath:string,
		private readonly test_env:any)
	{
		const xmlFile = fs.readFileSync(xmlPath+'/test.xml', 'utf8');
		this.testData = JSON.parse(convert.xml2json(xmlFile, {compact: true, spaces: 2}))["snort-test"]; 
		this.executor = this.test_env.SNORT3_TEST_ROOT+'/bin/snorttest.py';
	}

	getName():string {return this.testData.name._text;}
	getDescription():string {return this.testData.description._text;}
	execute(testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'running' });
			this.active_child = child_process.spawn(this.executor,
				['--daq-dir',this.test_env.SNORT_TEST_DAQ_DIR,
				'--plugin-path', this.test_env.SNORT_TEST_PLUGIN_PATH,
				'--snort-test', this.test_env.SNORT3_TEST_ROOT,'-x',this.test_env.SNORT_PREFIX,'.'],
				{cwd:this.xmlPath,env:this.test_env}).once('exit',(code,signal)=>{
					if(!(signal || code)){
						try{
							let result=fs.readFileSync(this.xmlPath+'/results','utf8').toString().substring(0,8).split('\t')[0].toLowerCase();
							if(result==='error') result = 'errored';
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: result });
						} catch{
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'errored' });
						}
					} else {
						testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'errored' });
					}
					this.active_child=undefined;
					resolve();
				});
			if(!this.active_child){
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'errored' });
				resolve();
			}
		});
		/* -- for debugging -- 
		return new Promise((resolve)=>{
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'running' });
			setTimeout(()=>{testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.xmlPath, state: 'passed' }); resolve();},500);
		});
		*/
		/*
		return new Promise((resolve)=>{
			testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'running' });
			if(this.testData["pre-test"])
				this.pre_test(id, testStatesEmitter).finally(()=>{resolve();});
			else
				this.run_test(id, testStatesEmitter).finally(()=>{resolve();});
		});
		*/
	}
/*
	private getSnortCmdLine():string[]
	{
		let cmd_line:string[]=['-H','-U'];
		cmd_line.push('--daq-dir');
		cmd_line.push(this.test_env.SNORT_TEST_DAQ_DIR);
		cmd_line.push('--plugin-path');
		cmd_line.push(this.test_env.SNORT_TEST_PLUGIN_PATH);
		if(this.testData.options){
			<string>(this.testData.options._text).split(' ').forEach((option:string) => {
				cmd_line.push(option);
			});
		}
		if(this.testData.conf) {cmd_line.push('-c'); cmd_line.push(this.testData.conf._text); }

	}
*/
/*
	private pre_test(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const pre_test_cmd = (<string>(this.testData["pre-test"]._text)).split(' ');
			const cmd = pre_test_cmd.shift();
			if(cmd){
				this.active_child=child_process.spawn(cmd,pre_test_cmd,this.test_env).once('exit',(code,signal)=>{
					if(code == 0) this.run_test(id, testStatesEmitter).finally(()=>{resolve();});
					else 
					{if(signal) testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
					else testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'skipped' });
					resolve();}
				});
				if(!this.active_child.pid){testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
			} else {testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
		});
	}
	private run_script(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const script_cmd = (<string>(this.testData.script._text)).split(' ');
			const cmd = script_cmd.shift();
			if(cmd){
				this.active_child=child_process.spawn(cmd,script_cmd).once('exit',(code)=>{
					if(code===0) this.compare(id, testStatesEmitter).finally(()=>{resolve();});
					else {testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
					resolve();}
				});
				if(!this.active_child.pid){testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
			} else {
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
				resolve();
			}
		});
	}
	private run_snort(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const snort_cmd = ['dummy'];
			const config = vscode.workspace.getConfiguration('snort3TestExplorer');
			if(config){
				const cmd = config.get('sf_prefix_snort3')+'/bin/snort';
				this.active_child=child_process.spawn(cmd,snort_cmd).once('exit',(code)=>{
					if(code===0) this.compare(id, testStatesEmitter).finally(()=>{resolve();});
					else {testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
					resolve();}
				});
				if(!this.active_child.pid){testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
			} else {
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
				resolve();
			}
		});
	}
	private run_test(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			if(this.testData.script) this.run_script(id, testStatesEmitter).finally(()=>{resolve();});
			else this.run_snort(id, testStatesEmitter).finally(()=>{resolve()});
		});
	}
	private compare(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const compare_cmd = (<string>(this.testData.compare._text)).split(' ');
			const cmd = compare_cmd.shift();
			if(cmd) {
				this.active_child=child_process.spawn(cmd,compare_cmd).once('exit',(code)=>{
					if(code===0) this.post_test(id, testStatesEmitter).finally(()=>{resolve();});
					else {testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
					resolve();}
				});
				if(!this.active_child.pid){testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
			} else{
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
				resolve();
			}
		});
	}
	private post_test(id:string, testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
		TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
	{
		return new Promise((resolve)=>{
			const compare_cmd = (<string>(this.testData.compare._text)).split(' ');
			const cmd = compare_cmd.shift();
			if(cmd) {
				this.active_child=child_process.spawn(cmd,compare_cmd).once('exit',(code)=>{
					if(code===0) testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'passed' });
					else testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
					resolve();
				});
				if(!this.active_child.pid){testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' }); resolve();}
			} else {
				testStatesEmitter.fire(<TestEvent>{ type: 'test', test: id, state: 'errored' });
				resolve();
			}
		});
	}
*/
	reload():Promise<void>{
		return new Promise((resolve)=>{
			fs.readFile(this.xmlPath+'/test.xml', {encoding:'utf8'},(err,xmlFileData)=>
			{
				if(!err && xmlFileData) this.testData = JSON.parse(convert.xml2json(xmlFileData, {compact: true, spaces: 2}));
				resolve();
			});
		});
	}

	abort()
	{
		if(this.active_child) this.active_child.kill();
	}
}

export async function loadSnort3Tests(rootdir:vscode.WorkspaceFolder)
	:Promise<{suite:TestSuiteInfo,testDetails:Map<string,snort3Test>}>
{
	var sampleTestSuit: TestSuiteInfo = {
		type: 'suite',
		id: 'Snort3_test_root',
		label: 'Snort3_test_root',
		children: []
	};
	const test_env = Object.assign({},process.env);
	let executor_dir = rootdir.uri.path;
	let SF_PREFIX_SNORT3=<string>(buildtool.get_sf_prefix_snort3());
	let DEPENDENCY_DIR=<string>(buildtool.get_dependencies());
	let SNORT3_TEST_ROOT=executor_dir;

	test_env.SNORT_LUA_PATH=SF_PREFIX_SNORT3+'/etc/snort/';
	test_env.SNORT_INSTALL_PREFIX=SF_PREFIX_SNORT3;
	test_env.SNORT_PREFIX=SF_PREFIX_SNORT3;
	test_env.LD_LIBRARY_PATH=DEPENDENCY_DIR+'/libdaq/lib:'+SF_PREFIX_SNORT3+'/lib64:'+DEPENDENCY_DIR+'/safec/lib:'+DEPENDENCY_DIR+'/luajit/lib:'+DEPENDENCY_DIR+'/cpputest/lib64';
	test_env.PKG_CONFIG_PATH=SF_PREFIX_SNORT3+'/lib64/pkgconfig:'+DEPENDENCY_DIR+'/libdaq/lib/pkgconfig:'+DEPENDENCY_DIR+'/cpputest/lib64/pkgconfig:'+DEPENDENCY_DIR+'/luajit/lib/pkgconfig:'+DEPENDENCY_DIR+'/safec/lib/pkgconfig';
	test_env.PATH=test_env.PATH+':'+SF_PREFIX_SNORT3+'/bin:'+SNORT3_TEST_ROOT+'/bin:'+DEPENDENCY_DIR+'/abcip/bin:'+DEPENDENCY_DIR+'/libdaq/bin:';
	test_env.PYTHONPATH=SNORT3_TEST_ROOT+'/lib';
	test_env.LUA_PATH=SF_PREFIX_SNORT3+'/include/snort/lua/\?.lua\;\;';
	test_env.NFS_PCAP_DIR='/nfs/netboot/snort/snort-test/pcaps';
	test_env.SNORT_TEST_DAQ_DIR=DEPENDENCY_DIR+'/libdaq/lib/daq:'+SF_PREFIX_SNORT3+'/lib64/snort/daqs:'+SF_PREFIX_SNORT3+'/lib64/snort_extra/daqs:'+SF_PREFIX_SNORT3+'/lib64/snort_test/daqs';
	test_env.SNORT_TEST_PLUGIN_PATH=SF_PREFIX_SNORT3+'/lib64';
	test_env.SNORT_PLUGIN_PATH=SF_PREFIX_SNORT3+'/lib64';
	test_env.SNORT3_TEST_ROOT=SNORT3_TEST_ROOT;
	test_env.SNORT_SRCPATH=<string>(buildtool.get_snort3_src_path());
	
	var snort3Tests = new Map<string,snort3Test>();
	var walk = function(dir:string) {
		var list = fs.readdirSync(dir);
		if(list.includes('run.sh') && test_env.SNORT_SRCPATH){
			//spell test
			if (getLastItem(dir) === 'source'){
				const spells:TestSuiteInfo={
					type:'suite',
					id:dir,
					label:getLastItem(dir),
					children:[]
				};
				let src_id = dir;
				let extraTest:snort3SpellCheck|undefined = undefined;
				const extra_path = ''//<string>(buildtool.get_snort3_src_extra_path());
				if(extra_path !== ''){
					src_id = dir+'/snort3';
					extraTest = new snort3SpellCheck(dir+'/extra', dir, extra_path);
					snort3Tests.set(dir+'/extra', extraTest);
					spells.children.push(<TestInfo>{
						type: 'test',
						id: dir+'/extra',
						label: extraTest.getName(),
						file: dir + '/run.sh',
						description: extraTest.getDescription(),
						tooltip: extraTest.getName() + extraTest.getDescription()
					});
				}
				const srcTest:snort3SpellCheck = new snort3SpellCheck(src_id, dir, test_env.SNORT_SRCPATH);
				snort3Tests.set(src_id, srcTest);
				const src_test:TestInfo = {
					type: 'test',
					id: src_id,
					label: srcTest.getName(),
					file: dir + '/run.sh',
					description: srcTest.getDescription(),
					tooltip: srcTest.getName() + srcTest.getDescription()
				};
				if(spells.children.length) {
					spells.children.unshift(src_test);
					return spells;
				}
				else return src_test;
			} else {
				const thisTest = new snort3SpellCheck(dir, dir, test_env.SNORT_SRCPATH + '/doc');
				snort3Tests.set(dir,thisTest);
				return <TestInfo>{type: 'test',
					id: dir,
					label: thisTest.getName(),
					file: dir + '/run.sh',
					description: thisTest.getDescription(),
					tooltip:thisTest.getName() + thisTest.getDescription()
				};
			}
		}else if(list.includes('test.xml')){
			//reg test
			const file:string = dir + '/test.xml';
			const thisTest = new snort3RegTest(dir, test_env);
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
	var suite=walk(rootdir.uri.path);
	if(suite){
		sampleTestSuit.children.push(suite);
		return Promise.resolve({suite:sampleTestSuit,testDetails:snort3Tests});
	}
	return Promise.reject("No tests present under this root.");
}

export function runTest(test:snort3Test|undefined,
	testStatesEmitter:vscode.EventEmitter<TestRunStartedEvent |
	TestRunFinishedEvent | TestSuiteEvent | TestEvent>):Promise<void>
{
	if(test) return test.execute(testStatesEmitter);
	else return Promise.resolve();
}
