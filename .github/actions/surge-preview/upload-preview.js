const path = require('path');
const surge = require('surge');
const publishFn = surge().publish();

(async () => {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: process.env.GH_PR_TOKEN });

  const ghrepo = process.env.GITHUB_REPOSITORY || '';
  const owner = ghrepo.split('/')[0];
  const repo = ghrepo.split('/')[1];
  const prnum = process.env.GH_PR_NUM;
  const prbranch = process.env.GITHUB_REF.split('/').pop();

  const uploadFolder = process.argv[2];
  if (!uploadFolder) {
    console.log('Usage: upload-preview uploadFolder');
    process.exit(1);
  }

  // Validate uploadFolder is a relative path within the project
  const resolved = path.resolve(uploadFolder);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd)) {
    console.error('Error: uploadFolder must be within the project directory');
    process.exit(1);
  }

  // Validate prnum is a number if present
  if (prnum && !/^\d+$/.test(prnum)) {
    console.error('Error: GH_PR_NUM must be a numeric value');
    process.exit(1);
  }

  const uploadFolderName = path.basename(uploadFolder);

  // Use repo name dynamically instead of hardcoding
  const safeRepoPart = repo.replace(/[^a-zA-Z0-9-]/g, '-');
  const safeBranch = prbranch.replace(/[^a-zA-Z0-9-]/g, '-');
  let uploadURL = `${safeRepoPart}-${prnum ? `pr-${safeRepoPart}-${prnum}` : safeBranch}`;

  switch(uploadFolderName) {
    case 'coverage':
      uploadURL += '-a11y.surge.sh';
      break;
    case 'public':
      if (!prnum && prbranch === 'main') {
        uploadURL = 'https://pf-extensions.surge.sh/';
      } else {
        uploadURL += '.surge.sh';
      }
      break;
    default:
      uploadURL += `-${uploadFolderName.replace(/[^a-zA-Z0-9-]/g, '-')}`;
      uploadURL += '.surge.sh';
      break;
  }

  publishFn({
    project: uploadFolder,
    p: uploadFolder,
    domain: uploadURL,
    d: uploadURL,
    e: 'https://surge.surge.sh',
    endpoint: 'https://surge.surge.sh'
  });

  function tryAddComment(comment, commentBody) {
    if (!commentBody.includes(comment)) {
      return comment;
    }
    return '';
  }

  if (prnum) {
    const comments = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: Number(prnum)
    }).then(res => res.data);

    let commentBody = '';
    const existingComment = comments.find(comment => comment.user.login === 'patternfly-build');
    if (existingComment) {
      commentBody += existingComment.body.trim();
      commentBody += '\n\n';
    }

    if (uploadFolderName === 'public') {
      commentBody += tryAddComment(`Preview: https://${uploadURL}`, commentBody);
    } else if (uploadFolderName === 'coverage') {
      commentBody += tryAddComment(`A11y report: https://${uploadURL}`, commentBody);
    }

    if (existingComment) {
      await octokit.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: commentBody
      });
      console.log('Updated comment!');
    } else {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: Number(prnum),
        body: commentBody
      });
      console.log('Created comment!');
    }
  }
})();
