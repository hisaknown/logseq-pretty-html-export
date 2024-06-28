var converter = new showdown.Converter();
converter.setFlavor('github');

async function parseBlock (block, level = 0) {
    let parsedBlocks = [];  // should contain objects with content and level

    if (level > logseq.settings.maxNestedLevel) {
        return parsedBlocks;
    }

    let content = converter.makeHtml(block.content);
    content = content.replace(/^<p>(.*)<\/p>$/s, '$1');

    const embed = content.match(/{{embed \(\((.*)\)\)}}/);
    if (embed) {
        content = '';
        const embeddedBlock = await logseq.Editor.getBlock(embed[1], {includeChildren: true});
        parsedBlocks.push(await parseBlock(embeddedBlock, level));
    } else {
        parsedBlocks.push({ content: content, level: level });
    }

    if (block.children) {
        for (child of block.children) {
            parsedBlocks.push(await parseBlock(child, level + 1));
        }
    }
    parsedBlocks = parsedBlocks.flat();
    return parsedBlocks;
}

async function base64EncodeImage (img) {
    return new Promise((resolve, reject) => {
        fetch(img.src)
        .then(response => response.blob())
        .then(blob => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = function() {
                img.src = reader.result;
                resolve();
            }
        });
    });
};

async function exportPrettyHtml () {
    const currentPage = await logseq.Editor.getCurrentPage();
    const currentGraph = await logseq.App.getCurrentGraph();
    const graphPath = currentGraph.path;

    if (!currentPage) {
        logseq.UI.showMsg('Logseq-pretty-html-export: Please open a single page to export. (Maybe you are in journal view or graph view?)', 'warning', { timeout: 10000 });
        return;
    }
    if (!currentPage.originalName) {
        logseq.UI.showMsg('Logseq-pretty-html-export: Please open a single page to export. (Maybe you are selecting a block?)', 'warning', { timeout: 10000 });
        return;
    }
    const pageTitle = currentPage.originalName;
    const pageBlocks = await logseq.Editor.getCurrentPageBlocksTree();
    let parsedBlocks = [];
    for (block of pageBlocks) {
        parsedBlocks.push(await parseBlock(block));
    };
    parsedBlocks = parsedBlocks.flat();

    let currentLevel = -1;
    const container = document.createElement('div');
    let pointer = container;
    for (parsedBlock of parsedBlocks) {
        // resolve nest
        if (parsedBlock.level > currentLevel) {
            pointer = pointer.appendChild(document.createElement('ul'));
        } else if (parsedBlock.level < currentLevel) {
            for (let i = 0; i < currentLevel - parsedBlock.level; i++) {
                pointer = pointer.parentElement;
            }
        };
        currentLevel = parsedBlock.level;

        // ordered and unordered list
        if (parsedBlock.content.match(/logseq\.order-list-type:: number/)
            && pointer.tagName === 'UL') {
            pointer = pointer.parentElement;
            pointer = pointer.appendChild(document.createElement('ol'));
        } else if (!parsedBlock.content.match(/logseq\.order-list-type:: number/)
            && pointer.tagName === 'OL') {
            pointer = pointer.parentElement;
            pointer = pointer.appendChild(document.createElement('ul'));
        }
        parsedBlock.content = parsedBlock.content.replace(/<br \/>\nlogseq\.order-list-type:: number/, '');

        // backgroud color
        const bgColor = parsedBlock.content.match(/background-color:: (.*)/);
        if (bgColor) {
            switch (bgColor[1]) {
                case 'yellow':
                    bgColor[1] = '#efd36c';
                    break;
                case 'red':
                    bgColor[1] = '#f3aeaf';
                    break;
                case 'pink':
                    bgColor[1] = '#ecadd4';
                    break;
                case 'green':
                    bgColor[1] = '#92ceac';
                    break;
                case 'blue':
                    bgColor[1] = '#96c7f2';
                    break;
                case 'purple':
                    bgColor[1] = '#d3b4ed';
                    break;
                case 'gray':
                    bgColor[1] = '#6b7280';
                    break;
                default:
                    break;
            }
            parsedBlock.content =  `<span style="background-color: ${bgColor[1]};">${parsedBlock.content}</span>`;
        }
        parsedBlock.content = parsedBlock.content.replace(/<br \/>\nbackground-color:: (.*)/, '');

        // images
        const images = parsedBlock.content.match(/<img src="(.*)" alt="(.*)" \/>({:height [0-9]+, :width [0-9]+})?/g);
        if (images) {
            for (image of images) {
                const height = image.match(/{:height ([0-9]+), :width [0-9]+}/)?.slice(1);
                const width = image.match(/{:height [0-9]+, :width ([0-9]+)}/)?.slice(1);

                let imgpath = image.match(/<img src="(.*)" alt="(.*)" \/>/)[1];
                let imgalt = image.match(/<img src="(.*)" alt="(.*)" \/>/)[2];
                imgpath = imgpath.replace(/^../, 'file://' + graphPath);
                if (width) {  // NOTE: in Logseq app, only width works?
                    parsedBlock.content = parsedBlock.content.replace(image, `<img src="${imgpath}" alt="${imgalt}" width="${width}">`);
                    parsedBlock.content = parsedBlock.content.replace(/{:height [0-9]+, :width [0-9]+}/, '');
                } else {
                    parsedBlock.content = parsedBlock.content.replace(image, `<img src="${imgpath}" alt="${imgalt}">`);
                }
            }
        }

        // hide metadata
        parsedBlock.content = parsedBlock.content.replace(/<br \/>\nid:: .*$/m, '');
        parsedBlock.content = parsedBlock.content.replace(/<br \/>\ncollapsed:: true$/m, '');

        if (logseq.settings.suppressEmptyLines && parsedBlock.content === '') {
            pointer.innerHTML += '<li style="list-style-type: &quot; &quot;;"> </li>';
        } else {
            pointer.innerHTML += `<li>${parsedBlock.content}</li>`;
        }
    };
    // replace image to base64
    const imgs = container.querySelectorAll('img');
    if (logseq.settings.embedLocalImages) {
        for (img of imgs) {
            if (img.src.startsWith('file://')) {
                await base64EncodeImage(img);
            }
        }
    }

    const content = container.innerHTML;

    let html = logseq.settings.htmlTemplate;
    html = html.replace(/\${pageTitle}/g, pageTitle);
    html = html.replace(/\${content}/g, content);

    // save to file
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageTitle}.html`;
    a.click();
    URL.revokeObjectURL(url);
}

function main () {  // entrypoint
    logseq.provideModel({
        exportPrettyHtml () {
            exportPrettyHtml();
        }
    });
    logseq.App.registerUIItem('toolbar', {
        key: 'pretty-html-export',
        template: `
        <a class="button" data-on-click="exportPrettyHtml">
        <i class="ti ti-source-code"></i>
        </a>
        `
    });
    logseq.useSettingsSchema([
        {
            key: 'htmlTemplate',
            description: `HTML template for export.<br>
Use the following placeholders: <br>
<ul>
<li> <code>\${pageTitle}</code>: page title string </li>
<li> <code>\${content}</code>: page content HTML </li>
</ul>`,
            type: 'string',
            inputAs: 'textarea',
            default: `<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css" integrity="sha512-heNHQxAqmr9b5CZSB7/7NSC96qtb9HCeOKomgLFv9VLkH+B3xLgUtP73i1rM8Gpmfaxb7262LFLJaH/hKXyxyA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
<style>
body {
    box-sizing: border-box;
    min-width: 200px;
    max-width: 980px;
    margin: 0 auto;
    padding: 45px;
}
</style>

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>hljs.initHighlightingOnLoad();</script>

<title>\${pageTitle}</title>
</head>
<body>
<article class="markdown-body">
<h1>\${pageTitle}</h1>
\${content}
</article>
</body>
</html>`,
            title: 'HTML Template',
        },
        {
            key: 'maxNestedLevel',
            description: 'Max nested level to export. Mainly for prevent infinite block embedding loop.',
            type: 'number',
            default: 10,
            title: 'Max Nested Level',
        },
        {
            key: 'suppressEmptyLines',
            description: 'Suppress empty lines in exported HTML.',
            type: 'boolean',
            default: true,
            title: 'Suppress Empty Lines',
        },
        {
            key: 'embedLocalImages',
            description: 'Embed local images as base64 in exported HTML.',
            type: 'boolean',
            default: true,
            title: 'Embed Local Images',
        },
    ])
}

// bootstrap
logseq.ready(main).catch(console.error);
