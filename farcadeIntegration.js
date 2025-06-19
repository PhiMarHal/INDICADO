// farcadeIntegration.js
// Script to integrate Farcade SDK into index.html

const fs = require('fs');
const path = require('path');

const config = {
    indexTemplate: 'index.html',
    outputFile: 'index.farcade.html',
};

function extractAssetUrlsFromComments(htmlContent) {
    console.log('Extracting asset URLs from comments...');
    const assetUrlMap = {};

    // Regex to find asset loading lines with URLs in comments
    // Matches: this.load.image('key', 'path'); // https://url
    const assetCommentRegex = /this\.load\.(?:image|audio)\(['"]([^'"]+)['"],\s*['"][^'"]+['"]\);\s*\/\/\s*(https?:\/\/[^\s]+)/g;

    let match;
    while ((match = assetCommentRegex.exec(htmlContent)) !== null) {
        const assetKey = match[1];
        const assetUrl = match[2];
        assetUrlMap[assetKey] = assetUrl;
        console.log(`  Found asset '${assetKey}' -> '${assetUrl}'`);
    }

    return assetUrlMap;
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

function writeFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content);
        console.log(`Successfully created file: ${filePath}`);
    } catch (error) {
        console.error(`Error writing file ${filePath}:`, error.message);
    }
}

function injectFarcadeSDK(html) {
    console.log('Injecting Farcade SDK script tag...');
    const farcadeScriptTag = '    <script src="https://cdn.jsdelivr.net/npm/@farcade/game-sdk@latest/dist/index.min.js"></script>';
    // Inject the Farcade SDK script right before the closing </head> tag.
    return html.replace(/<\/head>/, `${farcadeScriptTag}\n</head>`);
}

function replaceAssetPathsWithUrls(htmlContent) {
    console.log('Replacing local asset paths with hosted URLs...');

    // Extract URLs from comments in the HTML content
    const assetUrlMap = extractAssetUrlsFromComments(htmlContent);

    if (Object.keys(assetUrlMap).length === 0) {
        console.warn('No asset URLs found in comments! Make sure your HTML has comments with URLs.');
        return htmlContent;
    }

    let modifiedContent = htmlContent;

    // Regex to find this.load.image or this.load.audio calls and capture:
    // p1: 'this.load.image(' or 'this.load.audio('
    // p2: asset key (e.g., 'hero')
    // p3: ', ' (comma and space)
    // p4: opening quote of the path (e.g., ''')
    // p5: current path (e.g., 'assets/hero.png')
    // p6: closing quote and semicolon (e.g., ''');')
    const loadCallRegex = /(this\.load\.(?:image|audio)\(['"])([^'"]+)(['"],\s*)(['"])([^'"]+)(['"]\);)/g;

    modifiedContent = modifiedContent.replace(loadCallRegex, (match, p1, assetKey, p3, p4, currentPath, p6) => {
        if (assetUrlMap[assetKey]) {
            console.log(`  Replacing path for '${assetKey}': '${currentPath}' -> '${assetUrlMap[assetKey]}'`);
            // Reconstruct the line with the new URL.
            // p4 already contains the opening quote, p6 already contains the closing quote and semicolon.
            // So we just insert the new URL.
            return `${p1}${assetKey}${p3}${p4}${assetUrlMap[assetKey]}${p6}`;
        }
        return match; // Return original if no mapping found
    });

    return modifiedContent;
}

function injectFarcadeGameLogic(html) {
    console.log('Injecting Farcade SDK game logic...');

    let modifiedHtml = html;

    // 1. Inject ready() call - now in buildGame() instead of create()
    const buildGamePattern = /(buildGame\s*\(\)\s*\{[\s\S]*?console\.log\('Game built - Ready to start'\);)/;
    modifiedHtml = modifiedHtml.replace(buildGamePattern, (match) => {
        return `${match}

                // Farcade SDK: Signal that the game is fully loaded and ready to play.
                if (window.FarcadeSDK) {
                    window.FarcadeSDK.singlePlayer.actions.ready();
                    console.log('Farcade SDK: Game ready signal sent.');
                }`;
    });

    // 2. Inject Farcade SDK gameOver call and remove buildGame() from slideTitleIn completion
    const slideTitleInPattern = /(onComplete:\s*\(\)\s*=>\s*\{[\s\S]*?this\.gameState\s*=\s*'menu';[\s\S]*?\/\/\s*Build the game again for next round[\s\S]*?)(this\.buildGame\(\);)/;
    modifiedHtml = modifiedHtml.replace(slideTitleInPattern, (match, beforeBuildGame, buildGameCall) => {
        return `${beforeBuildGame}
                        // Farcade SDK: Signal game over and submit the player's score after full death sequence
                        if (window.FarcadeSDK) {
                            const scoreValue = Math.floor(this.gameTime / 10); // Converts milliseconds to centiseconds
                            window.FarcadeSDK.singlePlayer.actions.gameOver({ score: scoreValue });
                            console.log('Farcade SDK: Game over signal sent with score:', scoreValue);
                        }
                        
                        // Note: buildGame() removed for Farcade - will be called by play_again handler`;
    });

    // 3. Inject play_again and toggle_mute event handlers - updated for new architecture
    const phaserGameInstancePattern = /(const\s+game\s*=\s*new\s+Phaser\.Game\(config\);)/;
    modifiedHtml = modifiedHtml.replace(phaserGameInstancePattern, (match) => {
        return `${match}\n\n        // Farcade SDK: Register event handlers for 'play_again' and 'toggle_mute'.\n        if (window.FarcadeSDK) {\n            // Handle play again requests from Farcade.\n            window.FarcadeSDK.on('play_again', () => {\n                console.log('Farcade SDK: Play again requested.');\n                const activeScene = game.scene.getScene('InfiniteRunner');\n                if (activeScene) {\n                    // Build the game and show play button for user to tap\n                    activeScene.buildGame();\n                    console.log('Farcade SDK: Game rebuilt and ready for player interaction.');\n                } else {\n                    console.warn('Farcade SDK: Could not find active scene to rebuild game.');\n                }\n            });\n\n            // Handle mute/unmute requests from Farcade.\n            window.FarcadeSDK.on('toggle_mute', (data) => {\n                console.log('Farcade SDK: Mute toggle requested, isMuted:', data.isMuted);\n                // Use Phaser's global sound manager to mute/unmute all audio\n                game.sound.mute = data.isMuted;\n                console.log('Farcade SDK: All game audio mute state set to:', data.isMuted);\n            });\n        }`;
    });

    return modifiedHtml;
}

async function integrateFarcade() {
    console.log('Starting Farcade integration process...');

    let htmlContent = readFile(config.indexTemplate);
    if (!htmlContent) {
        console.error('Could not read HTML template. Aborting.');
        return;
    }

    // Step 1: Replace local asset paths with hosted URLs
    htmlContent = replaceAssetPathsWithUrls(htmlContent);

    // Step 2: Inject Farcade SDK script tag
    htmlContent = injectFarcadeSDK(htmlContent);

    // Step 3: Inject Farcade SDK game logic (ready, gameOver, play_again, toggle_mute)
    htmlContent = injectFarcadeGameLogic(htmlContent);

    writeFile(config.outputFile, htmlContent);

    console.log('Farcade integration complete! Output file:', config.outputFile);
}

// Execute the integration function
integrateFarcade();