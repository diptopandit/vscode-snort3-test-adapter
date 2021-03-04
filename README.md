# Snort3 Test Explorer for Visual Studio Code

Snort3 Test Explorer is a visual studio code extension that lets you run snort3 tests in the Sidebar of Visual Studio Code. This extention will activate when there is a snort3_test folder open in the workspace and automatically list all the tests available in the [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) side bar.

## Setup

* install the [Snort3 Test Explorer](https://marketplace.visualstudio.com/items?itemName=diptopandit.snort3-test-adapter) extension
* make sure the [Snort3 Build Tools](https://marketplace.visualstudio.com/items?itemName=diptopandit.snort3-build-tools) extention is installed
* configure the [Snort3 Build Tools](https://marketplace.visualstudio.com/items?itemName=diptopandit.snort3-build-tools) extention properly
* open an workspace with snort3 and snort3_test folder in it
* configure and build snort3 for regtest using [Snort3 Build Tools](https://marketplace.visualstudio.com/items?itemName=diptopandit.snort3-build-tools)

You should now see a tree view of all the tests in the side panel:

![The snort3 test suite](https://raw.githubusercontent.com/diptopandit/vscode-snort3-test-adapter/master/img/fake-tests.png)

Click on the run test button to start the tests

Currently pcap based regressions and spell test is supported
