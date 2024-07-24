import BigNumber from "bignumber.js";
import {
  RAY,
  WAD,
  HALF_RAY,
  HALF_WAD,
  WAD_RAY_RATIO,
  HALF_PERCENTAGE,
  PERCENTAGE_FACTOR,
} from "../constants";
import { BigNumberish } from "ethers";

declare global {
  interface BigInt {
    toBigInt: () => bigint;
    ray: () => bigint;
    wad: () => bigint;
    halfRay: () => bigint;
    halfWad: () => bigint;
    halfPercentage: () => bigint;
    wadMul: (a: bigint) => bigint;
    wadDiv: (a: bigint) => bigint;
    rayMul: (a: bigint) => bigint;
    rayDiv: (a: bigint) => bigint;
    percentMul: (a: bigint) => bigint;
    percentDiv: (a: bigint) => bigint;
    rayToWad: () => bigint;
    wadToRay: () => bigint;
    multipliedBy: (a: BigNumberish) => bigint;
    equals: (a: BigNumberish) => boolean;
  }
}

BigInt.prototype.toBigInt = function (): bigint {
  return BigInt(this.toString());
};

BigInt.prototype.ray = (): bigint => {
  return BigInt(RAY);
};

BigInt.prototype.wad = (): bigint => {
  return BigInt(WAD);
};

BigInt.prototype.halfRay = (): bigint => {
  return BigInt(HALF_RAY);
};

BigInt.prototype.halfWad = (): bigint => {
  return BigInt(HALF_WAD);
};

BigInt.prototype.halfPercentage = (): bigint => {
  return BigInt(HALF_PERCENTAGE);
};

BigInt.prototype.wadMul = function (b: bigint): bigint {
  return (this.halfWad() + this.toBigInt() * b) / BigInt(WAD);
};

BigInt.prototype.wadDiv = function (a: bigint): bigint {
  const halfA = a / 2n;
  return (halfA + this.toBigInt() * BigInt(WAD)) / a;
};

BigInt.prototype.rayMul = function (b: bigint): bigint {
  return (this.halfRay() + this.toBigInt() * b) / BigInt(RAY);
};

BigInt.prototype.rayDiv = function (a: bigint): bigint {
  const halfA = a / 2n;
  return (halfA + this.toBigInt() * BigInt(RAY)) / a;
};

BigInt.prototype.percentMul = function (b: bigint): bigint {
  return (
    (this.halfPercentage() + this.toBigInt() * b) / BigInt(PERCENTAGE_FACTOR)
  );
};

BigInt.prototype.percentDiv = function (a: bigint): bigint {
  const halfA = a / 2n;
  return (halfA + this.toBigInt() * BigInt(PERCENTAGE_FACTOR)) / a;
};

BigInt.prototype.rayToWad = function (): bigint {
  const halfRatio = BigInt(WAD_RAY_RATIO) / 2n;
  return halfRatio + this.toBigInt() / BigInt(WAD_RAY_RATIO);
};

BigInt.prototype.wadToRay = function (): bigint {
  return this.toBigInt() * BigInt(WAD_RAY_RATIO);
};

BigInt.prototype.multipliedBy = function (a: BigNumberish): bigint {
  const mult = new BigNumber(this.toString()).multipliedBy(a.toString());
  return BigInt(mult.decimalPlaces(0, BigNumber.ROUND_DOWN).toFixed());
};

BigInt.prototype.equals = function (a: BigNumberish): boolean {
  return this.toString() === a.toString();
};
