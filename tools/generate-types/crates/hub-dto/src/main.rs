// Adapted from ManaBrew xtask/src/gen_types.rs; see workspace LICENSE.md.
// Only the DTO source is compiled, never the hub or engine crates.
#[allow(dead_code, unused_imports)]
mod dto;
use anyhow::{Context, Result};
use dto::{
    AccessTokenResponse, AccountAssetList, AccountDeckDetail, AccountDeckList, AccountDeckSummary,
    AccountExport, AdminTopDeckSnapshotRequest, AssetUpload, AuthProviders, AuthSessionResponse,
    Capability, CardCollection, ChatReportRequest, CreateAccountDeckRequest,
    CreateAssetUploadRequest, DeckHubEntryDetail, DeckHubEntryList, DeckHubEntrySummary,
    DeckHubFacets, DeckHubTag, DeckPlayReportRequest, DeckVersionDetail, DeckVersionSummary,
    EmailVerifyRequest, ExchangeCodeRequest, FavoriteResponse, GuestTokenRequest, HubCapabilities,
    MagicLinkRequest, MeResponse, MissingCapabilityError, OAuthStartRequest, OAuthStartResponse,
    PublishDeckHubEntryRequest, RevocationRequest, SaveDeckVersionRequest, SetAccountAvatarRequest,
    TokenRequest, TopDeckBucket, TopDeckSnapshot, UpdateDeckHubEntryRequest, UpdateHandleRequest,
    VerifyCardPrintingsRequest, VerifyCardPrintingsResponse,
};
use std::{fs, path::PathBuf};
use ts_rs::TS;

const DECK_IMPORT: &str = "import type { Deck, DeckFormat } from \"@/protocol/deck\";\nimport type { EngineKind } from \"@/protocol\";\n\n";

fn main() -> Result<()> {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .context("expected output directory")?,
    );
    fs::create_dir_all(&out)?;
    for name in ["hubTypes.ts", "authTypes.ts"] {
        let path = out.join(name);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    HubCapabilities::export_all_to(&out).context("export HubCapabilities")?;
    Capability::export_all_to(&out).context("export Capability")?;
    MissingCapabilityError::export_all_to(&out).context("export MissingCapabilityError")?;
    CardCollection::export_all_to(&out).context("export CardCollection")?;
    VerifyCardPrintingsRequest::export_all_to(&out).context("export VerifyCardPrintingsRequest")?;
    VerifyCardPrintingsResponse::export_all_to(&out)
        .context("export VerifyCardPrintingsResponse")?;
    DeckPlayReportRequest::export_all_to(&out).context("export DeckPlayReportRequest")?;
    ChatReportRequest::export_all_to(&out).context("export ChatReportRequest")?;
    CreateAccountDeckRequest::export_all_to(&out).context("export CreateAccountDeckRequest")?;
    SaveDeckVersionRequest::export_all_to(&out).context("export SaveDeckVersionRequest")?;
    AccountDeckSummary::export_all_to(&out).context("export AccountDeckSummary")?;
    AccountDeckList::export_all_to(&out).context("export AccountDeckList")?;
    AccountDeckDetail::export_all_to(&out).context("export AccountDeckDetail")?;
    AccountExport::export_all_to(&out).context("export AccountExport")?;
    DeckVersionSummary::export_all_to(&out).context("export DeckVersionSummary")?;
    DeckVersionDetail::export_all_to(&out).context("export DeckVersionDetail")?;
    DeckHubTag::export_all_to(&out).context("export DeckHubTag")?;
    PublishDeckHubEntryRequest::export_all_to(&out).context("export PublishDeckHubEntryRequest")?;
    UpdateDeckHubEntryRequest::export_all_to(&out).context("export UpdateDeckHubEntryRequest")?;
    DeckHubEntrySummary::export_all_to(&out).context("export DeckHubEntrySummary")?;
    DeckHubEntryList::export_all_to(&out).context("export DeckHubEntryList")?;
    DeckHubEntryDetail::export_all_to(&out).context("export DeckHubEntryDetail")?;
    DeckHubFacets::export_all_to(&out).context("export DeckHubFacets")?;
    FavoriteResponse::export_all_to(&out).context("export FavoriteResponse")?;
    TopDeckBucket::export_all_to(&out).context("export TopDeckBucket")?;
    TopDeckSnapshot::export_all_to(&out).context("export TopDeckSnapshot")?;
    AdminTopDeckSnapshotRequest::export_all_to(&out)
        .context("export AdminTopDeckSnapshotRequest")?;

    CreateAssetUploadRequest::export_all_to(&out).context("export CreateAssetUploadRequest")?;
    AssetUpload::export_all_to(&out).context("export AssetUpload")?;
    AccountAssetList::export_all_to(&out).context("export AccountAssetList")?;
    SetAccountAvatarRequest::export_all_to(&out).context("export SetAccountAvatarRequest")?;

    AuthProviders::export_all_to(&out).context("export AuthProviders")?;
    OAuthStartRequest::export_all_to(&out).context("export OAuthStartRequest")?;
    OAuthStartResponse::export_all_to(&out).context("export OAuthStartResponse")?;
    ExchangeCodeRequest::export_all_to(&out).context("export ExchangeCodeRequest")?;
    AuthSessionResponse::export_all_to(&out).context("export AuthSessionResponse")?;
    MeResponse::export_all_to(&out).context("export MeResponse")?;
    MagicLinkRequest::export_all_to(&out).context("export MagicLinkRequest")?;
    EmailVerifyRequest::export_all_to(&out).context("export EmailVerifyRequest")?;
    UpdateHandleRequest::export_all_to(&out).context("export UpdateHandleRequest")?;
    AccessTokenResponse::export_all_to(&out).context("export AccessTokenResponse")?;
    TokenRequest::export_all_to(&out).context("export TokenRequest")?;
    GuestTokenRequest::export_all_to(&out).context("export GuestTokenRequest")?;
    RevocationRequest::export_all_to(&out).context("export RevocationRequest")?;

    let path = out.join("hubTypes.ts");
    let generated = fs::read_to_string(&path).context("read hubTypes.ts")?;
    fs::write(&path, format!("{DECK_IMPORT}{generated}")).context("write hubTypes.ts")?;
    Ok(())
}
