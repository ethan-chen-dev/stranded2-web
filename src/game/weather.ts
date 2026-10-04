/**
 * 天气，依据 e_environment.bb（e_environment_setweather、天气更新）与 game_changeday.bb 的天气分支。
 * 0 晴、1 雨、2 雪、3 雷暴。气候 0 普通、1 寒冷时每天按 rainratio / snowratio 随机，2..5 固定为晴、雨、雪、雷暴。
 * 雨雪会熄灭全部火焰并阻止新的火焰状态；灰色罩随天气渐显到 0.75。
 */
export const WEATHER = { sun: 0, rain: 1, snow: 2, thunder: 3 } as const;

const FIXED_WEATHER: Record<number, number> = { 2: WEATHER.sun, 3: WEATHER.rain, 4: WEATHER.snow, 5: WEATHER.thunder };
const CLIMATE_NAMES: Record<string, number> = { normal: 0, arctic: 1, sun: 2, rain: 3, snow: 4, thunder: 5 };
const WEATHER_NAMES: Record<string, number> = { sun: 0, rain: 1, snow: 2, thunder: 3 };
const GREY_MAX = 0.75;
const GREY_PER_F = 0.002;
const THUNDER_SOUNDS = ['thunder1.wav', 'thunder2.wav', 'thunder3.wav'];

export interface WeatherDeps {
  /** 整数随机，含两端（Blitz Rand）。 */
  random(min: number, max: number): number;
  /** 浮点随机（Blitz Rnd）。 */
  rnd(min: number, max: number): number;
  /** 删除全部火焰状态。 */
  clearFire(): void;
  sound(file: string): void;
  /** 雨声循环，null 停止。 */
  loop(file: string | null): void;
  /** 全屏闪白（Cp_flash，加法混合）。 */
  flash(size: number, alpha: number): void;
  /** 在镜头附近 (dx, dz) 处生成雨滴或雪花。 */
  precipitation(kind: 'rain' | 'snow', dx: number, dz: number, size: number): void;
  diving(): boolean;
}

export class Weather {
  current: number = WEATHER.sun;
  climate: number;
  rainRatio: number;
  snowRatio: number;
  /** 灰色罩不透明度（env_wa）。 */
  grey = 0;
  private acc20 = 0;
  private acc1000 = 0;
  private acc2000 = 0;
  private raining = false;

  constructor(private readonly d: WeatherDeps, climate: number, ratios: { rain: number; snow: number }, saved?: number) {
    this.climate = climate;
    this.rainRatio = ratios.rain;
    this.snowRatio = ratios.snow;
    this.current = FIXED_WEATHER[climate] ?? (saved !== undefined && saved >= 0 && saved <= 3 ? saved : WEATHER.sun);
    this.grey = this.current !== WEATHER.sun ? GREY_MAX : 0;
  }

  /** 雨雪时不能起火（handle_states.bb set_state）。 */
  get blocksFire(): boolean {
    return this.current === WEATHER.rain || this.current === WEATHER.snow;
  }

  /** e_environment_setweather。 */
  set(weather: number): void {
    this.current = weather;
    if (this.blocksFire) this.d.clearFire();
  }

  /** game_cd 的天气分支。 */
  changeDay(): void {
    switch (this.climate) {
      case 0: this.set(this.d.random(1, 100) <= this.rainRatio ? WEATHER.rain : WEATHER.sun); break;
      case 1: this.set(this.d.random(1, 100) <= this.snowRatio ? WEATHER.snow : WEATHER.sun); break;
      default: this.set(FIXED_WEATHER[this.climate] ?? WEATHER.sun);
    }
  }

  /** 脚本 climate 命令；参数可为编号或名字，无效返回 false。 */
  setClimate(value: string): boolean {
    const c = /^\d+$/.test(value) ? Number(value) : CLIMATE_NAMES[value.toLowerCase()];
    if (c === undefined || c < 0 || c > 5) return false;
    this.climate = c;
    if (c === 0) { if (this.current > WEATHER.rain) this.set(this.d.random(0, 1)); }
    else if (c === 1) { if (this.current !== WEATHER.sun && this.current !== WEATHER.snow) this.set(this.d.random(0, 1) * 2); }
    else this.set(FIXED_WEATHER[c]);
    return true;
  }

  /** 脚本 weather 命令。 */
  setWeather(value: string): boolean {
    const w = /^\d+$/.test(value) ? Number(value) : WEATHER_NAMES[value.toLowerCase()];
    if (w === undefined || w < 0 || w > 3) return false;
    this.set(w);
    return true;
  }

  /** 每帧：灰色罩渐变、降水粒子、雨声与雷声。paused 时只更新灰色罩。 */
  update(dtMs: number, paused: boolean): void {
    const f = dtMs / 20;
    this.grey = this.current !== WEATHER.sun ? Math.min(GREY_MAX, this.grey + GREY_PER_F * f) : Math.max(0, this.grey - GREY_PER_F * f);
    const diving = this.d.diving();
    const wantRain = !diving && this.current === WEATHER.rain;
    if (wantRain !== this.raining) {
      this.raining = wantRain;
      this.d.loop(wantRain ? 'rain.wav' : null);
    }
    if (paused || diving) return;
    this.acc20 += dtMs;
    this.acc1000 += dtMs;
    this.acc2000 += dtMs;
    const tick20 = this.acc20 >= 20;
    const tick1000 = this.acc1000 >= 1000;
    const tick2000 = this.acc2000 >= 2000;
    if (tick20) this.acc20 %= 20;
    if (tick1000) this.acc1000 %= 1000;
    if (tick2000) this.acc2000 %= 2000;
    const { d } = this;
    if (this.current === WEATHER.rain) {
      if (tick2000 && d.random(1, 10) === 1) this.thunder(0.1, 0.3, 0.5, 1);
      if (tick20) for (let i = 0; i < 3; i++) d.precipitation('rain', d.random(-150, 150), d.random(-100, 100), d.rnd(20, 30));
    } else if (this.current === WEATHER.snow) {
      if (tick20) for (let i = 0; i < 2; i++) d.precipitation('snow', d.random(-200, 200), d.random(-100, 100), d.rnd(30, 50));
    } else if (this.current === WEATHER.thunder) {
      if (tick1000 && d.random(1, 5) === 1) this.thunder(0.08, 0.3, 0.6, 1.3);
    }
  }

  private thunder(sizeMin: number, sizeMax: number, aMin: number, aMax: number): void {
    const { d } = this;
    d.sound(THUNDER_SOUNDS[d.random(0, 2)]);
    if (d.random(1, 5) !== 1) d.flash(d.rnd(sizeMin, sizeMax), d.rnd(aMin, aMax));
  }
}
