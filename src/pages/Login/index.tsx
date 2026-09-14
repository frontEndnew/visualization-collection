import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
// import { App } from 'antd';
import feishuLogo from '@/images/feishu-logo.svg';
// import { oidcLogin } from '@/services/user';

import './index.scss';

// 标记"已发起 SSO 登录"，用于从 SSO 跳回后自动完成登录（避免需要点两次）
const SSO_INITIATED_KEY = 'sso_login_initiated';

// ==================== 光标拖尾效果：颜色动画 ====================
class Wave {
  phase: number;
  offset: number;
  frequency: number;
  amplitude: number;
  value: number;

  constructor(opt: { phase?: number; offset?: number; frequency?: number; amplitude?: number } = {}) {
    this.phase = opt.phase || 0;
    this.offset = opt.offset || 0;
    this.frequency = opt.frequency || 0.001;
    this.amplitude = opt.amplitude || 1;
    this.value = 0;
  }

  update() {
    this.phase += this.frequency;
    this.value = this.offset + Math.sin(this.phase) * this.amplitude;
    return this.value;
  }
}

// ==================== 光标拖尾效果：物理节点 ====================
class Node {
  x: number = 0;
  y: number = 0;
  vx: number = 0;
  vy: number = 0;
}

// ==================== 光标拖尾效果：弹簧物理线条 ====================
class Line {
  spring: number;
  friction: number;
  nodes: Node[];

  constructor(spring: number) {
    this.spring = spring + 0.1 * Math.random() - 0.02;
    this.friction = 0.5 + 0.01 * Math.random() - 0.002;
    this.nodes = [];
    const size = 30;
    for (let i = 0; i < size; i++) {
      const n = new Node();
      n.x = 0;
      n.y = 0;
      this.nodes.push(n);
    }
  }

  update(pos: { x: number; y: number }, E: { friction: number; dampening: number; tension: number }) {
    let e = this.spring;
    let t = this.nodes[0];
    t.vx += (pos.x - t.x) * e;
    t.vy += (pos.y - t.y) * e;
    for (let i = 0; i < this.nodes.length; i++) {
      t = this.nodes[i];
      if (i > 0) {
        const n = this.nodes[i - 1];
        t.vx += (n.x - t.x) * e;
        t.vy += (n.y - t.y) * e;
        t.vx += n.vx * E.dampening;
        t.vy += n.vy * E.dampening;
      }
      t.vx *= this.friction;
      t.vy *= this.friction;
      t.x += t.vx;
      t.y += t.vy;
      e *= E.tension;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    let n = this.nodes[0].x;
    let i = this.nodes[0].y;
    ctx.beginPath();
    ctx.moveTo(n, i);
    for (let a = 1; a < this.nodes.length - 2; a++) {
      const e = this.nodes[a];
      const t = this.nodes[a + 1];
      n = 0.5 * (e.x + t.x);
      i = 0.5 * (e.y + t.y);
      ctx.quadraticCurveTo(e.x, e.y, n, i);
    }
    const e = this.nodes[this.nodes.length - 2];
    const t = this.nodes[this.nodes.length - 1];
    ctx.quadraticCurveTo(e.x, e.y, t.x, t.y);
    ctx.stroke();
    ctx.closePath();
  }
}

const LoginEffect: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  // const { message } = App.useApp();

  // 光标 & 画布 refs
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const linesRef = useRef<Line[]>([]);
  const posRef = useRef({ x: 0, y: 0 });
  const waveRef = useRef<Wave | null>(null);
  const lastTimeRef = useRef<number>(0);
  const frameRef = useRef<number>(1);
  const isInitializedRef = useRef(false);

  // Spline viewer 容器 ref
  const splineContainerRef = useRef<HTMLDivElement>(null);

  // ==================== 加载 Spline viewer 脚本 ====================
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'https://unpkg.com/@splinetool/viewer@1.9.54/build/spline-viewer.js';
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // ==================== 初始化 Spline viewer ====================
  useEffect(() => {
    if (splineContainerRef.current && !splineContainerRef.current.querySelector('spline-viewer')) {
      const splineViewer = document.createElement('spline-viewer');
      splineViewer.setAttribute('url', 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode');
      splineViewer.className = 'spline-viewer-container';
      splineContainerRef.current.appendChild(splineViewer);
    }
  }, []);

  // ==================== 初始化光标拖尾动画 ====================
  useEffect(() => {
    const canvas = canvasRef.current;
    const cursorDot = cursorDotRef.current;
    if (!canvas || !cursorDot) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 配置参数
    const E = { friction: 0.5, trails: 12, size: 30, dampening: 0.25, tension: 0.98 };
    const targetFPS = 60;
    const frameInterval = 1000 / targetFPS;

    // 初始化 Wave
    waveRef.current = new Wave({
      phase: Math.random() * 2 * Math.PI,
      amplitude: 85,
      frequency: 0.0015,
      offset: 285,
    });

    // 创建线条
    const createLines = () => {
      linesRef.current = [];
      for (let i = 0; i < E.trails; i++) {
        linesRef.current.push(new Line(0.4 + (i / E.trails) * 0.025));
      }
    };

    // 调整画布大小
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    // 鼠标移动处理
    const onMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) {
        posRef.current.x = e.touches[0].pageX;
        posRef.current.y = e.touches[0].pageY;
      } else {
        posRef.current.x = e.clientX;
        posRef.current.y = e.clientY;
      }
      if (cursorDot) {
        cursorDot.style.left = posRef.current.x + 'px';
        cursorDot.style.top = posRef.current.y + 'px';
      }
    };

    // 初始化函数（首次鼠标移动后才激活拖尾）
    const init = (e: MouseEvent) => {
      document.removeEventListener('mousemove', init);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove);
      onMove(e);
      createLines();
      isInitializedRef.current = true;
    };

    // 渲染函数
    const render = (currentTime: number) => {
      if (!isInitializedRef.current) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const deltaTime = currentTime - lastTimeRef.current;
      if (deltaTime < frameInterval) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }
      lastTimeRef.current = currentTime - (deltaTime % frameInterval);

      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';

      const wave = waveRef.current;
      if (wave) {
        const lightness = 50 + Math.sin(wave.update() * 0.01) * 30;
        ctx.strokeStyle = `hsla(0, 0%, ${lightness}%, 0.15)`;
        ctx.lineWidth = 1;
        for (let i = 0; i < E.trails; i++) {
          linesRef.current[i].update(posRef.current, E);
          linesRef.current[i].draw(ctx);
        }
      }

      frameRef.current++;
      animationFrameRef.current = requestAnimationFrame(render);
    };

    resize();
    document.addEventListener('mousemove', init);
    window.addEventListener('resize', resize);
    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      document.removeEventListener('mousemove', init);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      window.removeEventListener('resize', resize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // ==================== 登录成功后的统一跳转 ====================
  const redirectAfterLogin = useCallback(() => {
    const saved = sessionStorage.getItem('redirect_after_login');
    sessionStorage.removeItem('redirect_after_login');

    let target = '/';
    if (saved) {
      target = saved;
      // 兼容存入的完整 URL：归一化为站内相对路径，避免 navigate 失败
      if (/^https?:\/\//.test(saved)) {
        try {
          const url = new URL(saved);
          target = `${url.pathname}${url.search}${url.hash}`;
        } catch {
          target = '/';
        }
      }
      // 避免回跳到登录页自身
      if (target.startsWith('/login')) {
        target = '/';
      }
    }
    navigate(target, { replace: true });
  }, [navigate]);

  // ==================== 处理邮箱登录（预留） ====================
  const handleLogin = () => {
    if (!email) {
      // message.warning('请输入邮箱');
      alert('请输入邮箱');
      return;
    }
    // TODO: 实现登录逻辑
    // message.success('登录成功');
    alert('登录成功');
  };

  // ==================== 处理飞书登录 ====================
  const handleFeishuLogin = useCallback(async () => {
    try {
      // 先打标记：若 oidcLogin 触发整页跳转到 SSO，跳回后据此自动完成登录
      sessionStorage.setItem(SSO_INITIATED_KEY, '1');
      // const result = await oidcLogin();

      // if (result.needRedirect && result.redirectUrl) {
      //   // 未登录：整页跳转到 SSO（通常 401 时已由 axios 拦截器处理）
      //   window.location.href = result.redirectUrl;
      // } else {
      //   // 已登录：直接完成跳转
      //   sessionStorage.removeItem(SSO_INITIATED_KEY);
      //   redirectAfterLogin();
      // }

      // 临时跳转
      sessionStorage.removeItem(SSO_INITIATED_KEY);
      redirectAfterLogin();
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      // 401 由 axios 拦截器统一跳转到 SSO，这里不处理
      if (status !== 401) {
        sessionStorage.removeItem(SSO_INITIATED_KEY);
        // message.error('登录失败，请稍后重试');
        alert('登录失败，请稍后重试');
      }
    }
  }, [redirectAfterLogin]);

  // ==================== 从 SSO 跳回后自动完成登录 ====================
  useEffect(() => {
    if (sessionStorage.getItem(SSO_INITIATED_KEY) !== '1') return;
    // 一次性：先清除标记，避免 SSO 仍未登录时来回跳转造成死循环
    sessionStorage.removeItem(SSO_INITIATED_KEY);

    let cancelled = false;
    (async () => {
      try {
        // const result = await oidcLogin();
        // if (cancelled) return;
        // if (result.needRedirect && result.redirectUrl) {
        //   window.location.href = result.redirectUrl;
        // } else {
        //   redirectAfterLogin();
        // }
        redirectAfterLogin();
      } catch {
        // 仍未登录：401 已由拦截器处理；其他错误则停留在登录页等待用户手动点击
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [redirectAfterLogin]);

  return (
    <div className="login-page">
      {/* 光标效果 */}
      <div ref={cursorDotRef} className="cursor-dot" />
      <canvas ref={canvasRef} className="cursor-canvas" />

      {/* 3D 机器人动画区域（Spline viewer） */}
      <div className="spline-container" ref={splineContainerRef} />

      {/* 科技感网格背景（轻微） */}
      <div className="grid-overlay" />

      {/* Logo区域 */}
      {/* <div className="login-logo-container">
        <KbotLogo
          height={48}
          className="login-logo"
        />
      </div> */}

      {/* 中央登录表单 */}
      <div className="login-container">
        <div className="login-card">
          {/* 标题 */}
          <div className="login-header">
            <h1 className="login-title">欢迎来到 Pegasus</h1>
            <div className="title-decoration" />
            <p className="login-subtitle">超维动力 Kinetix AI 具身平台</p>
          </div>

          {/* 推荐登录方式 */}
          <div className="divider">
            <span>推荐使用飞书登录</span>
          </div>

          <div className="social-login">
            <button
              className="social-button feishu primary-social"
              title="飞书登录"
              onClick={handleFeishuLogin}
            >
              <img src={feishuLogo} alt="飞书" width="24" height="24" />
              <span className="feishu-text">飞书登录</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginEffect;