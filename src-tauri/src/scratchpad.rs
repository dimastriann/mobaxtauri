use std::sync::Arc;
use russh::client::AuthResult;
use russh::keys::{PrivateKeyWithHashAlg, ssh_key::PrivateKey};

pub async fn test_auth(session: &mut russh::client::Handle<()>, key_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let key_data = std::fs::read_to_string(key_path)?;
    let key = PrivateKey::from_openssh(&key_data)?;
    let key_arc = Arc::new(key);
    
    // How to create PrivateKeyWithHashAlg?
    let alg = russh::keys::PrivateKeyWithHashAlg::new(key_arc.clone(), None)?;
    let auth_res = session.authenticate_publickey("user", alg).await?;
    
    Ok(())
}
