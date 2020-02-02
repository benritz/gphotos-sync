import S3 from 'aws-sdk/clients/s3'
import DynamoDB from 'aws-sdk/clients/dynamodb'
import fs from 'fs'
import {Observable, from, EMPTY} from 'rxjs'
import {expand, map, mergeMap, take} from 'rxjs/operators'
import {OAuth2Client} from 'google-auth-library';
import http from 'http';
import https from 'https'
import url from 'url';
import open from 'open';
import enableDestroy from 'server-destroy';

interface PhotoMetadata {
    cameraMake?: string;
    cameraModal?: string;
    focalLength?: number;
    apertureFNumber?: number;
    isoEquivalent?: number;
}

interface MediaMetadata {
    creationTime: string;
    width: string;
    height: string;
    photo?: PhotoMetadata;
}

interface MediaItem {
    id: string;
    productUrl: string;
    baseUrl: string;
    mimeType: string;
    mediaMetadata: MediaMetadata;
    filename: string;
}

interface MediaItemsResult {
    pageToken?: string;
    mediaItems: MediaItem[],
    nextPageToken?: string
}

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

const getMediaItems = (): Observable<MediaItemsResult> => {
    const getPage = (client: OAuth2Client, pageToken?: string): Observable<MediaItemsResult> => {
        let url = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        return from(client.request<MediaItemsResult>({url})).pipe(
            map((resp) => {
                const result = resp.data;

                if (pageToken) {
                    result.pageToken = pageToken;
                }

                return result;
            })
        );
    };

    return getAuthenticatedClient(SCOPES).pipe(
        mergeMap((client) =>
            getPage(client).pipe(
                expand((data) => data['nextPageToken'] ? getPage(client, data['nextPageToken']) : EMPTY)
            )
        )
    );
};

var urlToFile = (url: string, dest: string): Observable<void> =>
    new Observable(subscriber => {
        var file = fs.createWriteStream(dest);
        var request = https.get(url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                file.close();
                subscriber.next();
            });
        }).on('error', function(err) { // Handle errors
            fs.unlink(dest, () => {}); // Delete the file async. (But we don't check the result)
            subscriber.error(err);
        });
    });


let total = 0;

getMediaItems().pipe(
    take(1),
    mergeMap((result) => {
        return from(result.mediaItems.map((mediaItem) => {
            return urlToFile(`${mediaItem.baseUrl}=d`, mediaItem.mediaMetadata.creationTime + '.jpg');
        })).pipe(mergeMap(x => x))
    })
).subscribe({ next: (x) => {
    console.log(x);
        // result.mediaItems.forEach((mediaItem) => {
        //     console.log(mediaItem.productUrl);
        //     console.log(mediaItem.baseUrl);
        //     console.log(mediaItem.mediaMetadata.creationTime);
        // });
}, error: (err) => { console.error(err); }});
