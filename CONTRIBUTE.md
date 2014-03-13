Contribute to the Telerik AppBuilder Command-Line Interface
===

*Help us improve the Telerik AppBuilder CLI* 

[![Telerik AppBuilder](ab-logo.png "Telerik AppBuilder")](http://www.telerik.com/appbuilder "The Telerik AppBuilder web site")

The Telerik AppBuilder CLI lets you build, test, deploy, and publish hybrid mobile apps for iOS and Android from your favorite IDE or code editor. You can develop your projects locally from the convenience of your favorite code editor and run the command-line to test, build, deploy in the simulator or on devices, and publish your applications to App Store or Google Play.

* [Report an Issue](#bug "Learn how to report an issue")
* [Request a Feature](#request "Learn how to submit a feature or improvement request")
* [Contribute to the Code Base](#contribute "Learn how to submit your own improvements to the code")

<a id="bug"></a>
Report an Issue
===
If you find a bug in the source code or a mistake in the documentation, you can help us by submitting an issue to our <a href="https://github.com/Icenium/icenium-cli">GitHub Repository</a>.
Before you submit your issue search the archive, maybe your question was already answered.
If your issue appears to be a bug, and hasn't been reported, open a new issue. Help us to maximize the effort we can spend fixing issues and adding new features, by not reporting duplicate issues. Providing the following information will increase the chances of your issue being dealt with quickly:

* Overview of the issue - if an error is being thrown a stack trace helps
* Motivation for or Use Case - explain why this is a bug for you
* Telerik AppBuilder Version(s) - is it a regression?
* Operating System - is this a problem with all operating systems?
* Reproduce the error - provide an unambiguous set of steps.
* Related issues - has a similar issue been reported before?
* Suggest a Fix - if you can't fix the bug yourself, perhaps you can point to what might be causing the problem (line of code or commit)

[Back to Top][1]

<a id="request"></a>
Request a Feature
===
You can request a new feature by submitting an issue with an enhancement tag to our <a href="https://github.com/Icenium/icenium-cli">GitHub Repository</a>.
If you would like to implement a new feature then consider submitting it to the <a href="https://github.com/Icenium/icenium-cli">GitHub Repository</a> as a Pull Request.

[Back to Top][1]

<a id="contribute"></a>
Contribute to the Code Base
===
First read our <a href="https://github.com/Icenium/icenium-cli/blob/develop/for-developers.md">developers documentation</a> if you haven't done that already.

Before you submit your Pull Request consider the following guidelines:

* Search <a href="https://github.com/Icenium/icenium-cli/pulls">GitHub</a> for an open or closed Pull Request that relates to your submission. You don't want to duplicate effort.
* Make your changes in a new git branch. We use the <a href="http://nvie.com/posts/a-successful-git-branching-model/">Gitflow branching model</a> so you will have to branch from our develop branch:
```
    git checkout -b my-fix-branch develop
```
* Create your patch, including appropriate test cases.
* Commit your changes and create a descriptive commit message (the commit message is used to generate release notes):
```
    git commit -a
```
* Build your changes locally:
```
    grunt
```
* Ensure all the tests pass:
```
    grunt test
```
* Push your branch to GitHub:
```
    git push origin my-fix-branch
```
* In GitHub, send a Pull Request to icenium-cli:develop.

* If we suggest changes then you can modify your branch, rebase and force a new push to your GitHub repository to update the Pull Request:
```
    git rebase develop -i
    git push -f
```
* That's it! Thank you for your contribution!

When the patch is reviewed and merged, you can safely delete your branch and pull the changes from the main (upstream) repository:

* Delete the remote branch on GitHub:
```
    git push origin --delete my-fix-branch
```
* Check out the develop branch:
```
    git checkout develop -f
```
* Delete the local branch:
```
    git branch -D my-fix-branch
```
* Update your develop with the latest upstream version:
```
    git pull --ff upstream develop
```

[Back to Top][1]

[1]: #contribute-to-the-telerik-appbuilder-command-line-interface
