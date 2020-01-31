import S3 from 'aws-sdk/clients/s3'
import DynamoDB from 'aws-sdk/clients/dynamodb'
import fs from 'fs'
import {Observable, from, EMPTY} from 'rxjs'
import {expand, map, mergeMap} from 'rxjs/operators'
import {OAuth2Client} from 'google-auth-library';
import http from 'http';
import url from 'url';
import open from 'open';
import enableDestroy from 'server-destroy';

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

const credentials = JSON.parse(fs.readFileSync('credentials.json').toString('utf8'));

function getAuthenticatedClient(scopes: string[]): Observable<OAuth2Client> {
    return new Observable((subscriber) => {
        const client = new OAuth2Client(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        );

        // try to read existing credentials from tokens.json
        try {
            client.setCredentials(JSON.parse(fs.readFileSync('tokens.json').toString('utf8')));

            subscriber.next(client);
            return;
        } catch (err) {
            // ignore
        }

        // get credentials
        const authorizeUrl = client
            .generateAuthUrl({ 'access_type': 'offline', scope: scopes });

        const server = http.createServer((req, res) => {
            try {
                if (req.url.includes('/sso')) {
                    const code = new url.URL(req.url, 'http://localhost:8888').searchParams.get('code');

                    res.end('Authentication successful! Please return to the console.');

                    server.destroy();

                    client.getToken(code)
                        .then((tokenResponse) => {
                            fs.writeFileSync('tokens.json', JSON.stringify(tokenResponse.tokens));

                            client.setCredentials(tokenResponse.tokens);
                            subscriber.next(client);
                        })
                        .catch((err) => subscriber.error(err));
                }
            } catch (e) {
                subscriber.error(e);
            }
        })
        .listen(8888, () => {
            open(authorizeUrl, {wait: false}).then(cp => cp.unref());
        });

        enableDestroy(server);
    });
}

function main(): Observable<object> {
    const getMediaItems = (client: OAuth2Client, pageToken?: string): Observable<{}> => {
        let url = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        return from(client.request<object>({url})).pipe(
            map((resp) => {
                const data = resp.data;

                if (pageToken) {
                    data['pageToken'] = pageToken;
                }

                return data;
            })
        );
    };

    return getAuthenticatedClient(SCOPES).pipe(
        mergeMap((client) =>
            getMediaItems(client).pipe(
                expand((data) => data['nextPageToken'] ? getMediaItems(client, data['nextPageToken']) : EMPTY)
            )
        )
    );
}

let total = 0;

main().subscribe({ next: (page) => {
        const count = page['mediaItems'].length;
        total += count;
        console.log(`${page['pageToken']} ${count}`);
        console.log(`Total: ${total}`);
}, error: (err) => { console.error(err); }});