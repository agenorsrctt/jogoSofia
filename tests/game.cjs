const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function setup() {
    const elements = new Map();
    let photosDrawn = 0;
    const draw = new Proxy({}, {get: (_, key) => key === 'createLinearGradient' ? () => ({addColorStop(){}}) : key === 'drawImage' ? () => {photosDrawn++;} : () => {}});
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            style: {}, attrs: {}, listeners: {}, classList: {add(){}, remove(){}},
            addEventListener(k, v){this.listeners[k] = v;},
            setAttribute(k, v){this.attrs[k] = v;}, getContext(){return draw;}
        });
        return elements.get(id);
    };
    const notes = [];
    const param = () => ({setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}});
    class AudioMock {
        constructor(){this.state = 'suspended'; this.currentTime = 0;}
        resume(){this.state = 'running'; return Promise.resolve();}
        createGain(){return {gain: param(), connect(){}, disconnect(){}};}
        createOscillator(){return {frequency: param(), connect(){}, disconnect(){}, start(){notes.push(this.type);}, stop(){}};}
    }
    const document = {getElementById: element, listeners: {}, hidden: false, addEventListener(k,v){this.listeners[k] = v;}};
    class ImageMock {
        constructor(){this.complete=true; this.naturalWidth=400; this.naturalHeight=500;}
        set src(value){
            assert.ok(fs.existsSync(path.join(__dirname, '..', decodeURIComponent(value))), 'image file exists');
            this.url=value;
        }
    }
    const sandbox = {Image:ImageMock, document, window: {innerWidth:390, innerHeight:844, AudioContext:AudioMock, addEventListener(){}}, navigator:{}, performance:{now:()=>1000}, requestAnimationFrame(){}};
    vm.createContext(sandbox);
    const run = code => vm.runInContext(code, sandbox);
    run(source);
    return {run, element, notes, document, photoCount:()=>photosDrawn};
}

(async () => {
    const {run, element, notes, document, photoCount} = setup();
    assert.equal(run('aviao.vida'), 200);
    run('criarBalao(); criarBalao(); criarBalao(true); desenharBaloes()');
    assert.equal(run('new Set(baloes.map(b=>b.imagem)).size'), 3, 'all photos alternate including giant');
    assert.equal(photoCount(), 3);
    run('baloes.forEach(b=>b.imagem.complete=false); desenharBaloes()');
    assert.equal(photoCount(), 3, 'unloaded photos use balloon fallback');
    run('imagensBaloes.forEach(i=>i.complete=true); baloes=[]');
    assert.equal(notes.length, 0);
    run('for(let i=0;i<100;i++) jogo()');
    assert.equal(run('tiros.length + baloes.length'), 0, 'wait for explicit start before firing');
    element('comecar').listeners.click();
    await Promise.resolve();
    assert.equal(run('jogoIniciado'), true);
    assert.equal(element('inicio').hidden, true);
    assert.ok(notes.length > 0, 'start button must play an audible confirmation');
    element('som').listeners.click();
    element('som').listeners.click();
    await Promise.resolve();
    assert.equal(element('som').attrs['aria-pressed'], 'true', 'first sound click must enable audio');
    run('criarTiro()');
    assert.equal(notes.at(-1), 'triangle');
    const count = notes.length;
    element('som').listeners.click();
    document.listeners.pointerdown({target:element('jogo')});
    run('criarTiro()');
    assert.equal(notes.length, count, 'mute must survive canvas interaction');
    element('som').listeners.click();
    await Promise.resolve();
    run('criarTiro()');
    assert.ok(notes.length > count);
    run('audioContext.state = "suspended"');
    document.listeners.keydown({target:element('jogo'), repeat:false});
    await Promise.resolve();
    assert.equal(run('audioContext.state'), 'running');

    for (const [score, level] of [[0,0],[9,0],[10,1],[24,1],[25,2],[49,2],[50,3]]) {
        run(`pontos=${score}; atualizarEvolucao(); baloes=[]; criarBalao(); desenharBaloes(); desenharAviao()`);
        assert.equal(run('nivel'), level);
        assert.equal(run('baloes[0].vida'), [3,6,10,15][level]);
        run('tiros=[]; criarTiro()');
        assert.equal(run('tiros.length'), [1,2,3,3][level]);
        assert.ok(run(`baloes[0].tamanho >= ${25 + level * 12}`));
        assert.ok(run('baloes[0].x - baloes[0].tamanho >= 0 && baloes[0].x + baloes[0].tamanho <= largura'));
    }
    run('baloes[0].x=100; baloes[0].y=100; tiros=[{x:100,y:100}]; verificarColisoes()');
    assert.equal(run('baloes[0].vida'), 14);
    assert.equal(run('pontos'), 50, 'nonlethal hit must not award a point');
    run('tiros=Array.from({length:15},()=>({x:100,y:100})); verificarColisoes()');
    assert.equal(run('baloes.length'), 0);
    assert.equal(run('pontos'), 51, 'only one reward per balloon');
    assert.equal(run('tiros.length'), 1);
    assert.equal(run('lancarMissil()'), false, 'no target means no missile');
    run('criarBalao(); baloes[0].y=200; nivel=2');
    assert.equal(run('lancarMissil()'), false, 'missiles are locked before maximum level');
    run('nivel=3; contadorMissil=89; atualizarMisseis()');
    assert.equal(run('misseis.length'), 1, 'automatic launch');
    run('const antigo=baloes[0]; baloes=[]; criarBalao(); baloes[0].y=220; atualizarMisseis()');
    assert.equal(run('misseis[0].alvo === baloes[0]'), true, 'retarget removed balloon');
    run('misseis[0].x=baloes[0].x; misseis[0].y=baloes[0].y; atualizarMisseis()');
    assert.equal(run('baloes[0].vida'), 12, 'missile deals three damage');
    assert.equal(run('misseis.length'), 0);
    run('baloes[0].vida=3; lancarMissil(); misseis[0].x=baloes[0].x; misseis[0].y=baloes[0].y; atualizarMisseis()');
    assert.equal(run('baloes.length'), 0);
    assert.equal(run('pontos'), 52);
    run('criarBalao(); baloes[0].y=200; for(let i=0;i<8;i++) lancarMissil()');
    assert.equal(run('misseis.length'), 4, 'active missile limit');
    run('baloes=[]; for(let i=0;i<250;i++) atualizarMisseis()');
    assert.equal(run('misseis.length'), 0, 'orphan missiles expire');
    run('tempoGigante=0; atualizarEventos(29)');
    assert.equal(run('baloes.length'), 0);
    run('atualizarEventos(1)');
    assert.equal(run('baloes.length'), 1);
    assert.equal(run('baloes[0].tamanho'), 228, 'giant is three times the largest regular balloon');
    assert.equal(run('baloes[0].vida'), 200);
    run('atualizarEventos(60)');
    assert.equal(run('baloes.length'), 1, 'only one giant at a time');
    run('for(let i=0;i<1000;i++) desenharBaloes()');
    assert.equal(run('baloes.length'), 1, 'giant stays until defeated');
    run('causarDano(baloes[0], 200)');
    assert.equal(run('pontos'), 62, 'giant rewards ten points');
    run('atualizarEventos(.01)');
    assert.equal(run('baloes.length'), 1, 'next giant appears when interval has elapsed');

    run('inimigos=[]; tirosInimigos=[]; criarInimigo(); inimigos[0].y=100; atualizarInimigos(1.3)');
    assert.equal(run('tirosInimigos.length'), 1, 'enemy fires at player');
    run('tirosInimigos=[{x:aviao.x,y:aviao.y,vx:0,vy:0,vida:7}]; atualizarInimigos(0)');
    assert.equal(run('lentidao'), .9);
    assert.equal(run('aviao.vida'), 190, 'enemy hit costs ten health');
    assert.equal(element('vida-aviao').value, 190);
    assert.equal(run('pontos'), 62, 'enemy hit never removes points');
    assert.equal(run('jogoIniciado'), true, 'enemy hit never ends game');
    run('atualizarInimigos(.5); tirosInimigos=[{x:aviao.x,y:aviao.y,vx:0,vy:0,vida:7}]; atualizarInimigos(0)');
    assert.equal(run('lentidao'), .4, 'protection prevents stacking slowdown');
    assert.equal(run('aviao.vida'), 190, 'shield prevents repeated health damage');
    run('atualizarInimigos(.5)');
    assert.equal(run('lentidao'), 0, 'movement recovers automatically');
    run('baloes=[]; inimigos[0].vida=1; tiros=[{x:inimigos[0].x,y:inimigos[0].y}]; verificarColisoes()');
    assert.equal(run('inimigos.length'), 0, 'player can shoot enemies down');
    run('for(let i=0;i<10;i++) criarInimigo()');
    assert.equal(run('inimigos.length'), 4);
    run('inimigos.forEach(i=>i.y=altura+100); tirosInimigos=[]; atualizarInimigos(.1)');
    assert.equal(run('inimigos.length'), 0, 'offscreen enemies cleaned up');
    run('aviao.vida=10; protecao=0; tirosInimigos=[{x:aviao.x,y:aviao.y,vx:0,vy:0,vida:7}]; atualizarInimigos(0)');
    assert.equal(run('aviao.vida'), 200, 'automatic repair preserves no-death gameplay');
    assert.equal(run('protecao'), 5);
    assert.equal(element('vida-aviao').value, 200);
    assert.equal(run('jogoIniciado'), true);
    console.log('PASS: audio, progression, three barrels, balloon health, giant timing/size/reward, missiles, enemies, temporary slowdown, invincibility and cleanup.');
})().catch(error => {console.error(error); process.exitCode = 1;});
