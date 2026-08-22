import meshyIdle3Url from '../../../assets/Meshy_AI_Animation_Idle_3_withSkin.glb?url';
import type { RiggedCharacterAssetId } from './riggedCharacterAssets';

const ASSET_URLS: Readonly<Record<RiggedCharacterAssetId, string>> = {
  'meshy-idle-3': meshyIdle3Url,
};

export function getBundledRiggedCharacterUrl(assetId: string) {
  return ASSET_URLS[assetId as RiggedCharacterAssetId];
}
