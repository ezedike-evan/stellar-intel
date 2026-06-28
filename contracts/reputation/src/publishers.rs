use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Publishers,
}

pub fn list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Publishers)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add(env: &Env, publisher: Address) {
    let mut publishers = list(env);
    if !publishers.contains(&publisher) {
        publishers.push_back(publisher);
        env.storage().instance().set(&DataKey::Publishers, &publishers);
    }
}

pub fn revoke(env: &Env, publisher: Address) {
    let mut publishers = list(env);
    if let Some(index) = publishers.first_index_of(&publisher) {
        publishers.remove(index);
        env.storage().instance().set(&DataKey::Publishers, &publishers);
    }
}

pub fn is_authorized(env: &Env, publisher: &Address) -> bool {
    let publishers = list(env);
    publishers.contains(publisher)
}
